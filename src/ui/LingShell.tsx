import { Button } from '@heroui/react/button'
import { Tooltip } from '@heroui/react/tooltip'
import { Fragment, useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  LingModelSelection,
  LingModelSettings,
  LingReadResult,
  LingTaskStatus,
  LingWorkspaceDocument,
} from '../runtime/contract.js'
import type { LingPresentedFile } from '../runtime/reply-features.js'
import { AutomationCenter } from './AutomationCenter.js'
import { BrowserPanel } from './BrowserPanel.js'
import { ChangeReview } from './ChangeReview.js'
import { Composer } from './Composer.js'
import { ComposerContext } from './ComposerContext.js'
import { ComposerNotice } from './ComposerNotice.js'
import { Conversation } from './Conversation.js'
import { DeliveryPreview } from './DeliveryCards.js'
import { FileBrowser } from './FileBrowser.js'
import { GitBranchMenu, GitDialog, GitPanel } from './GitPanel.js'
import { Icon } from './Icon.js'
import { InteractionPanel } from './InteractionPanel.js'
import { KnowledgeCenter } from './KnowledgeCenter.js'
import { Menu, MenuItem, MenuSeparator } from './Menu.js'
import { MessageQueue } from './MessageQueue.js'
import { MonitorSectionsContext } from './MonitorSection.js'
import { PromptDialog } from './PromptDialog.js'
import { QuickNotes } from './QuickNotes.js'
import { ServerFileBrowser } from './ServerFileBrowser.js'
import { ServerTerminalPanel } from './ServerTerminalPanel.js'
import { SettingsSidebar } from './SettingsSidebar.js'
import { SideTaskPanel } from './SideTaskPanel.js'
import { TaskGroupDialog } from './TaskGroupDialog.js'
import { TaskSearch } from './TaskSearch.js'
import { TaskViewMenu } from './TaskViewMenu.js'
import { TerminalPanel } from './TerminalPanel.js'
import { TokenUsagePopover } from './TokenUsagePopover.js'
import { WorkspaceCreateDialog, WorkspaceEditDialog } from './WorkspaceCreateDialog.js'
import { WorkspaceModeMenu } from './WorkspaceModeMenu.js'
import { WorkspaceActionOutput, WorkspaceToolsToolbar, useWorkspaceTools } from './WorkspaceTools.js'
import { toComposerQuote, workspaceContextScope, type WorkspaceContextReference } from './attachments.js'
import { updateBehavior, useBehavior } from './behavior-preferences.js'
import { ShellSettings, useShellSettingsRouting } from './shell/ShellSettings.js'
import { EnvironmentPanel } from './shell/TaskMonitor.js'
import { WorkbenchHeaderAction, WorkbenchHomeAction, WorkbenchTabs } from './shell/WorkbenchControls.js'
import { WorkspaceSection } from './shell/WorkspaceSection.js'
import type { LingShellProps } from './shell/types.js'
import { useShellGit } from './shell/useShellGit.js'
import {
  clampSidebarWidth,
  clampTerminalHeight,
  clampWorkbenchWidth,
  positionResizeMarker,
  sidebarMinWidth,
  sidebarWidthLimit,
  terminalHeightLimit,
  terminalMinHeight,
  useShellLayout,
  workbenchWidthBounds,
} from './shell/useShellLayout.js'
import { useShellNotes } from './shell/useShellNotes.js'
import { nativeRemoteBroker, remoteIssue, useShellRemote } from './shell/useShellRemote.js'
import { useTaskMonitor } from './shell/useTaskMonitor.js'
import { useTaskSidebar } from './shell/useTaskSidebar.js'
import { useWorkbench } from './shell/useWorkbench.js'
import { tw } from './tailwind.js'
import { useComputerSnapshot } from './useComputerSnapshot.js'

export { EnvironmentPanel, SubagentList } from './shell/TaskMonitor.js'
export type { LingExtensionProps, LingShellProps } from './shell/types.js'

const statusLabels: Record<LingTaskStatus, string> = {
  queued: '排队中',
  running: '进行中',
  'waiting-for-input': '等待输入',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export type { LingSettingsTab } from './settings-navigation.js'

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

function SlotItems({ items, prefix }: { readonly items?: readonly ReactNode[]; readonly prefix: string }) {
  return items?.map((item, index) => (
    <Fragment key={`${prefix}-${String(index)}`}>{item}</Fragment>
  ))
}

export function LingShell(props: LingShellProps) {
  const {
    attachments,
    browserOpen,
    connection,
    demo,
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
  const snapshot = useComputerSnapshot({ manager: props.extensions?.manager, computer: props.computerControl,
    draftId: selectedTask?.taskId ?? `new:${props.newTaskWorkspaceId ?? ''}:${props.newTaskServerId ?? ''}:${props.newTaskWithoutWorkspace ?? false}`,
    addFiles: onAddFiles, addQuote: props.onAddQuote, openWorkspace: props.onWorkspaceOpen })
  const {
    dialog,
    setDialog,
    creatingWorkspace,
    setCreatingWorkspace,
    editingWorkspace,
    setEditingWorkspaceId,
    creatingGroup,
    setCreatingGroup,
    editingGroupId,
    setEditingGroupId,
    taskViewState,
    setTaskViewState,
    workspaceAppearance,
    beginAddWorkspace,
    createWorkspace,
    saveWorkspace,
    saveGroup,
    allCollapsed,
    toggleAll,
    confirmDialog,
    dialogCopy,
  } = useTaskSidebar(props)
  const behavior = useBehavior()
  const modePreferences = behavior.modes[behavior.workMode]
  const [reviewSource, setReviewSource] = useState<'git' | 'task' | 'worktrees'>('git')
  const [gitOpen, setGitOpen] = useState(false)
  const { settingsGitWorkspace, setSettingsGitWorkspace, memoryRecapRequested, setMemoryRecapRequested } = useShellSettingsRouting(props.settingsTab)
  const {
    setTaskOperationsBinding,
    servers,
    taskServerId,
    taskRemoteCwd,
    setTaskRemoteCwd,
    taskFileBindingReady,
    remoteGitBranch,
    setRemoteGitBranch,
    remoteGitRequest,
    activeServerId,
    activeOperationsServerId,
    issueServerId,
    serverIssue,
    setServerIssue,
    serverIssuePending,
    setServerIssuePending,
  } = useShellRemote(props)
  const activeWorkspaceId = activeServerId ? undefined : selectedTask ? selectedTask.workspaceId
    : props.newTaskWithoutWorkspace ? undefined : props.newTaskWorkspaceId ?? workspaces[0]?.workspaceId
  const workspaceLabel = activeServerId ? servers.find(server => server.id === activeServerId)?.name ?? '服务器'
    : (selectedTask && !selectedTask.workspaceId) || (!selectedTask && props.newTaskWithoutWorkspace)
    ? '不指定工作区'
    : workspaces.find(workspace => workspace.workspaceId === (selectedTask?.workspaceId ?? props.newTaskWorkspaceId))?.label
      ?? workspaces[0]?.label ?? '不指定工作区'
  const {
    clearBrowserAnnotations,
    setBrowserAnnotations,
    workbenchMaximized,
    setWorkbenchMaximized,
    workbenchTabs,
    setWorkbenchTabs,
    activeWorkbenchTabId,
    setActiveWorkbenchTabId,
    activeWorkbenchTab,
    browserInitialized,
    browserNavigation,
    setBrowserNavigation,
    browserAnnotations,
    browserAnnotationResetKey,
    submitWithBrowserAnnotations,
    openWorkbenchTab,
    previewDelivery,
    closeWorkbenchTab,
    closeWorkbench,
  } = useWorkbench({ props, activeServerId, activeOperationsServerId, taskServerId, activeWorkspaceId, workspaceLabel })
  const {
    sidebarAvailableWidth,
    sidebarCollapsed,
    setSidebarCollapsed,
    setSidebarWidth,
    displayedSidebarWidth,
    sidebarDragStart,
    setTerminalHeight,
    displayedTerminalHeight,
    setWorkbenchWidth,
    workspaceAvailableWidth,
    workspaceAvailableHeight,
    displayedWorkbenchWidth,
    workbenchBounds,
  } = useShellLayout({ shortcutBlocked: Boolean(dialog || creatingWorkspace || editingWorkspace || creatingGroup || editingGroupId) })
  const { notesFloating, setNotesFloating, notesOrigin, notesError, requestNotes, handleNoteAction } = useShellNotes(props)
  const [knowledgeTarget, setKnowledgeTarget] = useState<{ workspaceId?: string; remoteTaskId?: string; documentId?: string }>()
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [actionOutputOpen, setActionOutputOpen] = useState(false)
  const workbenchOpen = screen === 'workspace' && browserOpen
  const {
    monitorPreferences,
    setMonitorPreferences,
    monitorState,
    monitorRef,
    monitorPresentation,
    monitorOpen,
    monitorFloating,
    monitorFixed,
    toggleLocalStatus,
    toggleMonitorPin,
    sections: monitorSections,
  } = useTaskMonitor({ screen, taskId: selectedTask?.taskId, workbenchOpen, workbenchMaximized, workspaceAvailableWidth })
  const terminalVisible = terminalOpen && screen === 'workspace'
  const isDarwin = document.documentElement.dataset.platform === 'darwin'

  const emptyConversation = timeline.length === 0 && !loadingOlder
  const fileContextScope = workspaceContextScope({ workspaceId: activeWorkspaceId, serverId: activeServerId, cwd: taskRemoteCwd })
  useEffect(() => {
    if (!selectedTask || (props.serverManager && taskFileBindingReady !== selectedTask.taskId)) return
    props.onWorkspaceContextScopeChange?.(fileContextScope)
  }, [selectedTask?.taskId, props.serverManager, taskFileBindingReady, fileContextScope, props.onWorkspaceContextScopeChange])
  const addFileContext = props.onAddWorkspaceContext ? (reference: WorkspaceContextReference) => {
    props.onAddWorkspaceContext?.(reference, fileContextScope)
  } : undefined
  const listDraftFiles = useCallback<LingShellProps['loadWorkspaceDirectory']>((_scope, path, signal) =>
    activeWorkspaceId && props.listDraftWorkspaceDirectory ? props.listDraftWorkspaceDirectory(activeWorkspaceId, path, signal)
      : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '工作区文件暂时不可用。', retryable: true }), [activeWorkspaceId, props.listDraftWorkspaceDirectory])
  const readDraftFile = useCallback<LingShellProps['loadWorkspaceDocument']>((_scope, path, signal) =>
    activeWorkspaceId && props.readDraftWorkspaceDocument ? props.readDraftWorkspaceDocument(activeWorkspaceId, path, signal)
      : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '工作区文件暂时不可用。', retryable: true }), [activeWorkspaceId, props.readDraftWorkspaceDocument])
  const saveDraftFile = useCallback<NonNullable<LingShellProps['saveWorkspaceDocument']>>((_scope, path, text, version, signal) =>
    activeWorkspaceId && props.saveDraftWorkspaceDocument ? props.saveDraftWorkspaceDocument(activeWorkspaceId, path, text, version, signal)
      : Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '工作区文件暂时不可用。', retryable: true }), [activeWorkspaceId, props.saveDraftWorkspaceDocument])
  const workspaceTools = useWorkspaceTools(activeWorkspaceId, props.workspaceTools)
  const { workspaceBranch, activeGitId, activeGitRequest, gitBranch, gitLineChanges, onGitChanged } = useShellGit({
    taskId: selectedTask?.taskId,
    activeWorkspaceId,
    activeServerId,
    monitorOpen,
    workspaceGitRequest: props.workspaceGit,
    remoteGitRequest,
    remoteGitBranch,
    setRemoteGitBranch,
    setTaskRemoteCwd,
    serverManager: props.serverManager,
    loadWorkspaceBranch: props.loadWorkspaceBranch,
  })
  const defaultLabel = defaultModelName(props.modelSettings)
  const modelLabel = (props.taskModelScoped
    ? (modelDisplayName(props.modelSettings, props.taskModel) || defaultLabel)
    : defaultLabel) || '选择模型'

  const openKnowledgeCenter = (project = false, documentId?: string) => {
    setKnowledgeTarget(project ? { workspaceId: activeWorkspaceId, remoteTaskId: activeServerId ? selectedTask?.taskId : undefined, documentId } : undefined)
    props.onKnowledgeOpen()
  }

  const forkConversationAt = useCallback((seq: number) => {
    if (selectedTask) return props.onFork(selectedTask.taskId, seq)
  }, [selectedTask?.taskId, props.onFork])
  const addConversationReply = useCallback((text: string, preview: string) => {
    props.onAddQuote(text, preview)
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')?.focus()
  }, [props.onAddQuote])

  const openDelivery = useCallback(async (taskId: string, file: LingPresentedFile): Promise<LingReadResult<void>> => {
    if (behavior.artifactOpen === 'right' || activeServerId) { previewDelivery(taskId, file); return { ok: true, value: undefined } }
    return props.replyFeatures?.openFile(taskId, file, AbortSignal.timeout(15_000)) ?? { ok: false, reason: 'runtime-unavailable', message: '系统应用打开暂不可用，请使用预览。', retryable: false }
  }, [behavior.artifactOpen, activeServerId, previewDelivery, props.replyFeatures])
  const readDelivery = useCallback(async (taskId: string, path: string, signal: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> => {
    if (activeServerId && props.serverManager) {
      const result = await props.serverManager.filesRead(taskId, path, signal)
      if (!result.ok) return result
      return { ok: true, value: { path, kind: /\.(md|markdown|mdown)$/iu.test(path) ? 'markdown' : 'text', mediaType: 'text/plain', text: result.value.text, truncated: result.value.truncated } }
    }
    return props.loadWorkspaceDocument(taskId, path, signal)
  }, [activeServerId, props.serverManager, props.loadWorkspaceDocument])

  const openExtensions = () => {
    onSettingsOpen()
    props.onSettingsTabChange('extensions')
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
              <button aria-label="新任务" className={tw("sidebar-nav__item group grid min-h-control grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-compact hover:bg-[var(--surface-hover)] max-[700px]:size-11 max-[700px]:min-h-11 max-[700px]:place-items-center max-[700px]:p-0")} onClick={onNewTask} type="button">
                <Icon name="compose" size={16} />
                <span className={tw("max-[700px]:hidden")}>新任务</span>
                <kbd className={tw("pointer-events-none font-sans text-xs text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 border-[var(--panel-border)] bg-[var(--surface)] max-[700px]:hidden")}>⌘ N</kbd>
              </button>
              <button aria-label="搜索" className={tw("sidebar-nav__item group grid min-h-control grid-cols-[auto_1fr_auto] items-center gap-2.5 rounded-lg border-0 bg-transparent px-3 text-left text-compact hover:bg-[var(--surface-hover)] max-[700px]:size-11 max-[700px]:min-h-11 max-[700px]:place-items-center max-[700px]:p-0")} onClick={onSearchOpen} type="button">
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
                selectedTask={screen === 'workspace' ? selectedTask : undefined}
                tasks={tasks}
                workspaces={workspaces}
                viewState={taskViewState}
                onViewStateChange={setTaskViewState}
                onEditGroup={setEditingGroupId}
                onEditWorkspace={setEditingWorkspaceId}
                onCreateGroup={() => { setCreatingGroup(true) }}
                onNewTaskInWorkspace={props.onNewTaskInWorkspace}
                workspaceAppearance={workspaceAppearance}
              /> : null}
            </div>

            <div className={tw("sidebar-bottom flex-none max-[700px]:mt-auto")}>
              <nav aria-label="本地工具" className={tw("sidebar-bottom__links grid gap-0.5 pt-2 px-0 pb-0 my-0 mx-3 max-[700px]:hidden")}>
                <button aria-current={screen === 'knowledge' ? 'page' : undefined} className={tw("sidebar-bottom__item flex min-h-control w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-compact [color:var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]", screen === 'knowledge' && "sidebar-bottom__item--active bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)]")} onClick={() => { openKnowledgeCenter() }} type="button">
                  <Icon className={tw("flex-none [color:var(--text-secondary)]")} name="book" size={17} /><span>知识中心</span>
                </button>
                <button aria-current={screen === 'automation' ? 'page' : undefined} className={tw("sidebar-bottom__item flex min-h-control w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-compact [color:var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]", screen === 'automation' && "sidebar-bottom__item--active bg-[var(--surface-selected)] hover:bg-[var(--surface-selected)]")} onClick={props.onAutomationOpen} type="button">
                  <Icon className={tw("flex-none [color:var(--text-secondary)]")} name="calendarClock" size={17} /><span>自动化</span>
                </button>
                <button className={tw("sidebar-bottom__item flex min-h-control w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 text-left text-compact [color:var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:[outline:2px_solid_var(--focus)] focus-visible:[outline-offset:1px]")} onClick={openExtensions} type="button">
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
        "workspace relative min-h-0 min-w-0 overflow-hidden my-[0.3rem] mr-[0.3rem] ml-[var(--workspace-inset)] rounded-2xl border border-[var(--panel-border)] bg-[var(--surface)] shadow-[var(--canvas-shadow)]",
        workbenchOpen
          ? tw(
              "workspace--workbench-open grid grid-cols-[minmax(0,calc(100%_-_var(--workbench-width)))_minmax(0,var(--workbench-width))]",
              terminalVisible ? "grid-rows-[2.5rem_minmax(0,1fr)_var(--terminal-height)]" : "grid-rows-[2.5rem_minmax(0,1fr)]",
              "max-[700px]:grid-cols-[minmax(0,1fr)]",
              workbenchMaximized && "workspace--workbench-maximized grid-cols-[minmax(0,1fr)]",
            )
          : "flex flex-col",
        screen === 'settings' && "bg-[var(--surface)]",
        monitorOpen && "workspace--monitor-open [--monitor-width:var(--monitor-docked-width)] max-[700px]:[--monitor-width:min(22rem,90vw)]",
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
        {screen === 'knowledge' ? null : screen === 'settings' ? <div aria-hidden="true" className={tw("h-10 shrink-0 select-none [-webkit-app-region:drag]")} /> : <header className={tw("workspace-header select-none [-webkit-app-region:drag] relative z-5 flex h-10 shrink-0 items-center justify-between bg-[var(--surface)] pr-2.5 pl-5", workbenchOpen && "col-start-1 row-start-1", workbenchOpen && workbenchMaximized && "hidden", workbenchOpen && "max-[700px]:hidden", sidebarCollapsed && isDarwin && "min-[701px]:pl-20")}>
          <div className={tw("workspace-header__leading flex items-center min-w-0 flex-1 gap-2")}>
            {sidebarCollapsed ? (
              <div className={tw("workspace-header__navigation [-webkit-app-region:no-drag] flex flex-none items-center gap-0.5", isDarwin && "min-[701px]:gap-0 min-[701px]:-translate-x-px min-[701px]:-translate-y-px")}>
                <button aria-expanded={false} aria-label="切换侧边栏" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)]", isDarwin && "min-[701px]:size-7.5")} onClick={() => { setSidebarCollapsed(false) }} title="展开侧边栏（⌘ B）" type="button"><Icon name="panelLeft" size={18} /></button>
                <button aria-label="后退" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateBack} onClick={onNavigateBack} title="后退" type="button"><Icon name="arrowLeft" size={16} /></button>
                <button aria-label="前进" className={tw("icon-button inline-grid size-control flex-none place-items-center rounded-lg border-0 bg-transparent p-0 hover:bg-[var(--surface-hover)] hover:[color:var(--foreground)] disabled:cursor-default disabled:opacity-35 disabled:hover:bg-transparent", isDarwin && "min-[701px]:size-7.5")} disabled={!props.canNavigateForward} onClick={onNavigateForward} title="前进" type="button"><Icon name="arrowRight" size={16} /></button>
              </div>
            ) : null}
            <div className={tw("workspace-header__title flex min-w-0 items-center gap-1.5")}>
              <strong className={tw("min-w-0 overflow-hidden text-ellipsis whitespace-nowrap font-semibold")} title={screen === 'automation' ? '自动化' : selectedTask?.title}>{screen === 'automation' ? '自动化' : selectedTask?.title ?? '新任务'}</strong>
              {screen === 'workspace' && selectedTask ? (
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
          {screen === 'automation' ? <div className={tw('flex items-center gap-2 [-webkit-app-region:no-drag]')}>{behavior.quickNotes || behavior.replyAnnotations ? <button type="button" aria-label="打开速记板" title="打开速记板 · ⌘/Ctrl+9" className={tw('grid size-8 place-items-center rounded-lg border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} onClick={() => requestNotes()}><Icon name="clipboard" size={17} /></button> : null}{screen === 'automation' ? <button className={tw('[-webkit-app-region:no-drag] rounded-md border-0 bg-transparent px-2.5 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} type="button" onClick={props.onWorkspaceOpen}>返回任务</button> : null}</div> : <div className={tw("workspace-header__actions [-webkit-app-region:no-drag] flex shrink-0 items-center gap-0.5")}>
            {modePreferences.locationControls && activeWorkspaceId ? <WorkspaceToolsToolbar key={activeWorkspaceId} workspaceId={activeWorkspaceId} tools={workspaceTools} actionsEnabled={behavior.workspaceActions} onRun={() => { setTerminalOpen(true); setActionOutputOpen(true) }} /> : null}
            <WorkbenchHeaderAction active={monitorOpen} controls="task-monitor" expanded={monitorOpen} icon="listCheck" label={monitorOpen ? '隐藏任务监控' : monitorPresentation === 'floating' ? '打开任务监控' : '显示任务监控'} onClick={toggleLocalStatus} />
            {behavior.quickNotes || behavior.replyAnnotations ? <Menu triggerAriaLabel="更多工具" triggerLabel={<Icon name="more" size={17} />} triggerClassName={tw('size-control-sm shrink-0 rounded-md border-0 bg-transparent p-0 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} listClassName="min-w-40">
              <MenuItem icon="clipboard" suffix="⌘/Ctrl+9" onPress={() => requestNotes(selectedTask?.taskId)}>打开速记板</MenuItem>
            </Menu> : null}
            {!browserOpen ? <>
              <WorkbenchHeaderAction active={terminalOpen} controls="workspace-terminal" expanded={terminalOpen} icon="terminalPanel" label="终端面板" onClick={() => { setTerminalOpen(current => !current) }} />
              <WorkbenchHeaderAction expanded={false} icon="panelRight" label="展开工作面" onClick={props.onBrowserToggle} />
            </> : null}
          </div>}
        </header>}

        {screen === 'automation' ? <AutomationCenter service={props.automation} workspaces={workspaces} workspaceId={activeWorkspaceId} models={props.modelSettings} onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }} /> : screen === 'knowledge' ? (
          <KnowledgeCenter models={props.modelSettings} headerInset={sidebarCollapsed && isDarwin} navigation={sidebarCollapsed ? <div className={tw('flex items-center gap-0.5')}>
            <button type="button" aria-label="切换侧边栏" aria-expanded={false} className={tw('icon-button grid size-7.5 place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)]')} onClick={() => setSidebarCollapsed(false)}><Icon name="panelLeft" size={18} /></button>
            <button type="button" aria-label="后退" disabled={!props.canNavigateBack} className={tw('icon-button grid size-7.5 place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)] disabled:opacity-35')} onClick={onNavigateBack}><Icon name="arrowLeft" size={16} /></button>
            <button type="button" aria-label="前进" disabled={!props.canNavigateForward} className={tw('icon-button grid size-7.5 place-items-center rounded-md border-0 bg-transparent hover:bg-[var(--surface-hover)] disabled:opacity-35')} onClick={onNavigateForward}><Icon name="arrowRight" size={16} /></button>
          </div> : undefined} headerActions={behavior.quickNotes || behavior.replyAnnotations ? <button type="button" aria-label="打开速记板" title="打开速记板 · ⌘/Ctrl+9" className={tw('grid size-8 place-items-center rounded-lg border-0 bg-transparent text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]')} onClick={() => requestNotes()}><Icon name="clipboard" size={17} /></button> : undefined} key={`${knowledgeTarget?.remoteTaskId ?? knowledgeTarget?.workspaceId ?? 'center'}:${knowledgeTarget?.documentId ?? ''}`} initialProject={!!knowledgeTarget} initialDocumentId={knowledgeTarget?.documentId} remoteTaskId={knowledgeTarget?.remoteTaskId ?? (activeServerId ? selectedTask?.taskId : undefined)} service={props.knowledge} workspaceId={knowledgeTarget?.workspaceId ?? activeWorkspaceId} workspaces={workspaces} taskId={selectedTask?.taskId} onOpenTask={taskId => { props.onWorkspaceOpen(); props.onSelectTask(taskId) }} onSettings={() => { setMemoryRecapRequested(true); onSettingsOpen(); props.onSettingsTabChange('memory') }} />
        ) : screen === 'settings' ? (
          <ShellSettings settings={props} memoryRecapRequested={memoryRecapRequested} setMemoryRecapRequested={setMemoryRecapRequested} activeWorkspaceId={activeWorkspaceId} settingsGitWorkspace={settingsGitWorkspace} setSettingsGitWorkspace={setSettingsGitWorkspace} remoteTaskId={activeServerId ? selectedTask?.taskId : undefined} remoteLabel={taskRemoteCwd} taskViewState={taskViewState} setTaskViewState={setTaskViewState} monitorPreferences={monitorPreferences} setMonitorPreferences={setMonitorPreferences} onOpenDialog={setDialog} onBrowseServerFiles={id => { props.onNewTaskOnServer(id); openWorkbenchTab('files') }} />
        ) : (
          <>
            <div className={tw("workspace-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden", workbenchOpen && "col-start-1 row-start-2", workbenchMaximized && "hidden", workbenchOpen && "max-[700px]:hidden", monitorFixed ? "w-[calc(100%_-_var(--monitor-width))]" : "w-full", selectedTask && "workspace-content--task", emptyConversation && "justify-center overflow-y-auto py-6")}>
            <section className={tw("conversation-canvas relative min-h-0 flex flex-1 overflow-hidden", emptyConversation && "flex-none overflow-visible")}>
              <Conversation
                replyFeatures={props.replyFeatures}
                suggestionDraftEmpty={!prompt.trim() && !props.attachments.length && !props.recordedAttachments?.length}
                onChooseSuggestion={text => { onPromptChange(text); window.requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')?.focus()) }}
                onOpenDelivery={openDelivery}
                onPreviewDelivery={previewDelivery}
                connection={connection}
                demo={demo}
                hasOlder={hasOlder}
                items={timeline}
              changes={modePreferences.fileChanges ? props.changes : undefined}
                onReviewChanges={selection => { setReviewSource('task'); openWorkbenchTab('review'); props.onChangeSelect(selection) }}
                loadAttachment={props.loadAttachment}
                loadingOlder={loadingOlder}
                onLoadOlder={onLoadOlder}
                onForkAt={selectedTask ? forkConversationAt : undefined}
                onEditMessage={props.onEditMessage}
                onRetryMessage={props.onRetryMessage}
                onCompactContext={props.onCompactContext}
                compactDisabled={connection.phase !== 'ready' || running || timeline.some(item => item.compaction && item.status === 'running')}
                onAddReply={addConversationReply}
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

            <div className={tw("composer-wrap relative [z-index:4] flex flex-col [width:min(var(--reading-width),calc(100%_-_var(--reading-gutter)*2))] [flex:0_1_auto] min-h-0 mt-0 mx-auto mb-2", emptyConversation && "shrink-0")}>
              {snapshot.error ? <ComposerNotice message={snapshot.error} onRetry={snapshot.retry} /> : null}
              {notesError ? <ComposerNotice message={notesError} /> : null}
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
              <MessageQueue key={selectedTask?.taskId ?? 'new-task'} items={props.pendingMessages ?? []} disabled={connection.phase !== 'ready'} onAction={props.onQueueAction} onWithdraw={props.onQueueWithdraw} onReorder={props.onQueueReorder} />
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
                compactDisabled={connection.phase !== 'ready' || running || timeline.some(item => item.compaction && item.status === 'running')}
                contextBreakdown={selectedTask?.contextBreakdown}
                contextPressure={selectedTask?.contextPressure}
                compaction={timeline.findLast(item => item.compaction)}
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
              <aside ref={monitorRef} data-presentation={monitorPresentation} data-pinned={monitorState.pinned} aria-label="任务监控" className={tw(
                "workspace-monitor absolute min-w-0 overflow-y-auto bg-[var(--surface)] [overscroll-behavior:contain]",
                workbenchMaximized && "hidden",
                monitorFloating
                  ? tw(
                      "z-6 top-10 bottom-auto w-[min(17.5rem,calc(100%_-_1.1rem))] max-h-[calc(100%_-_3.25rem)] rounded-xl border border-[var(--panel-border)] px-4 pb-3 shadow-[var(--overlay-shadow)]",
                      workbenchOpen ? "right-[calc(var(--workbench-width)_+_0.55rem)]" : "right-2",
                      terminalVisible && "max-h-[calc(100%_-_var(--terminal-height)_-_4rem)]",
                    )
                  : tw(
                      "z-3 top-10 right-0 bottom-0 w-[var(--monitor-width)] px-4 pb-4 pl-5",
                      terminalVisible && "bottom-[var(--terminal-height)]",
                    ),
              )} id="task-monitor" style={monitorFloating && workbenchOpen ? { width: Math.max(0, Math.min(280, workspaceAvailableWidth * (1 - displayedWorkbenchWidth / 100) - 18)) } : undefined}>
                <MonitorSectionsContext.Provider value={monitorSections}>
                {slots?.['rightbar.session'] ?? <EnvironmentPanel key={selectedTask?.taskId ?? 'new-task'} {...props} onPreviewDelivery={previewDelivery} environmentLabel={activeServerId ? workspaceLabel : undefined} environmentRemote={Boolean(activeServerId)} environmentPinned={monitorState.pinned} recapRemoteTaskId={activeServerId ? selectedTask?.taskId : undefined} onOpenRecap={id => openKnowledgeCenter(true, id)} gitLineChanges={gitLineChanges} onGitReview={activeGitId && activeGitRequest ? () => { setReviewSource('git'); openWorkbenchTab('review') } : undefined} onGitOpen={activeGitId && activeGitRequest ? () => setGitOpen(true) : undefined} workspaceBranch={gitBranch} onEnvironmentPinToggle={toggleMonitorPin} onSelectSideChat={id => { setActiveWorkbenchTabId(id); if (!browserOpen) props.onBrowserToggle() }} preferences={monitorPreferences} presentation={monitorPresentation} sideChats={workbenchTabs.filter(tab => tab.kind === 'side-task')} />}
                </MonitorSectionsContext.Provider>
              </aside>
            ) : null}
          </>
        )}
        {browserOpen && screen === 'workspace' ? (
        <aside aria-label="工作面" className={tw("workspace-workbench row-[1/3] flex min-h-0 min-w-0 flex-col overflow-hidden border-l border-[var(--panel-border)] bg-[var(--surface)]", workbenchMaximized ? "col-start-1" : "col-start-2", "max-[700px]:col-start-1")}>
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
                activeServerId && props.serverManager ? <section className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}><ServerFileBrowser key={activeServerId} service={props.serverManager} serverId={activeServerId} initialPath={taskRemoteCwd} onAddContext={addFileContext} workspaceLabel={workspaceLabel} /></section>
                  : props.supportsWorkspaceFiles && selectedTask ? <section className={tw("flex min-h-0 min-w-0 flex-1 flex-col")}><FileBrowser key={selectedTask.taskId} loadDirectory={props.loadWorkspaceDirectory} loadDocument={props.loadWorkspaceDocument} saveDocument={props.saveWorkspaceDocument} onAddContext={addFileContext} taskId={selectedTask.taskId} workspaceLabel={workspaceLabel} /></section>
                  : !selectedTask && activeWorkspaceId && props.listDraftWorkspaceDirectory && props.readDraftWorkspaceDocument ? <section className={tw('flex min-h-0 min-w-0 flex-1 flex-col')}><FileBrowser key={`workspace:${activeWorkspaceId}`} taskId={`workspace:${activeWorkspaceId}`} workspaceLabel={workspaceLabel} loadDirectory={listDraftFiles} loadDocument={readDraftFile} saveDocument={props.saveDraftWorkspaceDocument ? saveDraftFile : undefined} onAddContext={addFileContext} /></section>
                  : <div className={tw("grid min-h-0 flex-1 place-items-center p-6 text-sm [color:var(--text-tertiary)]")}>{selectedTask ? '当前运行时尚未提供本地文件浏览。' : '选择一个工作区以查看文件。'}</div>
              ) : null}
              {activeWorkbenchTab?.delivery ? <DeliveryPreview key={`${activeWorkbenchTab.delivery.taskId}:${activeWorkbenchTab.delivery.file.seq}:${activeWorkbenchTab.delivery.file.index}`} taskId={activeWorkbenchTab.delivery.taskId} file={activeWorkbenchTab.delivery.file} load={readDelivery} /> : null}
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
        </aside>
        ) : null}
        {browserOpen && !workbenchMaximized && screen === 'workspace' ? (
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
                closeWorkbench()
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

      {notesFloating ? <aside aria-label="独立速记浮窗" className={tw('fixed right-5 top-16 z-30 flex h-[min(760px,calc(100vh_-_5rem))] w-[min(420px,calc(100vw_-_2rem))] overflow-hidden rounded-2xl border border-[var(--panel-border)] shadow-[var(--overlay-shadow)]')}><QuickNotes initialOrigin={notesOrigin} onAction={handleNoteAction} onClose={() => setNotesFloating(false)} /></aside> : null}

      {creatingWorkspace ? <WorkspaceCreateDialog onCancel={() => { setCreatingWorkspace(false) }} onChooseDirectory={props.onPickDirectory} onConfirm={createWorkspace} /> : null}
      {editingWorkspace ? <WorkspaceEditDialog key={editingWorkspace.workspaceId} initial={editingWorkspace} onCancel={() => { setEditingWorkspaceId(undefined) }} onConfirm={draft => saveWorkspace(editingWorkspace.workspaceId, draft)} /> : null}
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
