import { useTaskMode } from './ui/use-task-mode.js'
import { acceptDraft, type ComposerDraft as Draft } from './ui/composer-draft.js'
import { useBehavior } from './ui/behavior-preferences.js'
import { readTaskWorkModes, rememberCreatedTaskMode } from './ui/task-work-modes.js'
import { useBehaviorNotifications } from './ui/behavior-notifications.js'
import { nativeBehavior } from './ui/BehaviorSettings.js'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createOfflineRuntimeAdapter } from './runtime/offline-adapter.js'
import type {
  LingAuthorizationInteraction,
  LingCommandResult,
  LingCustomProviderDraft,
  LingFileDiff,
  LingModelSelection,
  LingModelSettings,
  LingQuestionAnswer,
  LingRuntimeAdapter,
  LingTaskAgentPreset,
  LingTaskChanges,
  LingTaskGoal,
  LingTaskPermission,
  LingTaskSchedule,
  LingTaskSearchMatch,
  LingTaskSummary,
  LingTimelineItem,
} from './runtime/contract.js'
import { useLingRuntime } from './runtime/use-ling-runtime.js'
import { readyServerHome } from './runtime/server-preflight.js'
import { resendMessage } from './runtime/message-resend.js'
import { modelVisibilityKey, readConfirmedModels, readDisabledModels, replacementDefaultModel, saveConfirmedModels, saveDisabledModels, withModelVisibility } from './model-visibility.js'
import {
  browserStorageKey,
  draftStorageKey,
  parseStoredBrowserOpen,
  parseStoredDrafts,
  pickRestorableTaskId,
  selectedTaskStorageKey,
  serializeDrafts,
} from './session-state.js'
import type { ChangeSelection } from './ui/ChangeReview.js'
import { AgentPresetPicker } from './ui/AgentPresetPicker.js'
import { isComposerCommand } from './ui/Composer.js'
import { retryPending, type RetryRunner } from './ui/ComposerNotice.js'
import { releaseComposerAttachment, toComposerAttachment, toComposerQuote, toComposerWorkspaceContext, workspaceContextKey, workspaceContextScope, type ComposerAttachment, type WorkspaceContextReference } from './ui/attachments.js'
import { applyAppearance, updateAppearance, useAppearance, type LingTheme } from './theme.js'
import { LingShell, type LingExtensionProps, type LingSettingsTab } from './ui/LingShell.js'
import {
  lingUiExtensions,
  useLingUiSlots,
  type LingUiExtensionRegistry,
} from './ui/registry.js'
import type { LingUiSlots } from './ui/slots.js'
import { LING_RENDERER_VERSION } from './version.js'

const offlineRuntime = createOfflineRuntimeAdapter('灵创暂时无法连接。')
const newTaskKey = 'new-task'

type NavigationLocation =
  | { readonly screen: 'workspace'; readonly taskId?: string }
  | { readonly screen: 'settings'; readonly tab: LingSettingsTab }
  | { readonly screen: 'knowledge' }
  | { readonly screen: 'automation' }

interface NavigationHistory {
  readonly entries: readonly NavigationLocation[]
  readonly index: number
}

function sameLocation(left: NavigationLocation, right: NavigationLocation): boolean {
  return left.screen === right.screen && ((left.screen === 'knowledge' || left.screen === 'automation')
    ? true : left.screen === 'settings'
    ? right.screen === 'settings' && left.tab === right.tab
    : right.screen === 'workspace' && left.taskId === right.taskId)
}

const emptyDraft: Draft = { attachments: [], text: '' }

function readStoredDrafts(): Record<string, Draft> {
  const stored = parseStoredDrafts(window.localStorage.getItem(draftStorageKey))
  return Object.fromEntries(Object.entries(stored).map(([key, draft]) => [key, { ...draft, attachments: [] }]))
}

function storedBrowserOpen(): boolean {
  return parseStoredBrowserOpen(window.localStorage.getItem(browserStorageKey))
}

function storeBrowserOpen(open: boolean) {
  window.localStorage.setItem(browserStorageKey, open ? '1' : '0')
}

interface AppProps {
  readonly extensions?: LingUiExtensionRegistry
  readonly runtime?: LingRuntimeAdapter
  readonly slots?: LingUiSlots
}

export function App({ extensions = lingUiExtensions, runtime = offlineRuntime, slots }: AppProps) {
  const behavior = useBehavior()
  const [screen, setScreen] = useState<'workspace' | 'settings' | 'knowledge' | 'automation'>('workspace')
  const [settingsTab, setSettingsTab] = useState<LingSettingsTab>('general')
  const [navigation, setNavigation] = useState<NavigationHistory>({ entries: [{ screen: 'workspace' }], index: 0 })
  const pendingNavigation = useRef<NavigationLocation | undefined>(undefined)
  const [browserOpen, setBrowserOpen] = useState(storedBrowserOpen)
  const [newTaskWorkspaceId, setNewTaskWorkspaceId] = useState<string>()
  const [newTaskServerId, setNewTaskServerId] = useState<string>()
  const [newTaskOperationsServerId, setNewTaskOperationsServerId] = useState<string>()
  const [newTaskWithoutWorkspace, setNewTaskWithoutWorkspace] = useState(false)
  const [notice, setNotice] = useState('')
  const [retryAction, setRetryAction] = useState<RetryRunner>()
  const [drafts, setDrafts] = useState<Record<string, Draft>>(readStoredDrafts)
  const [composerFocusKey, setComposerFocusKey] = useState(0)
  const appearance = useAppearance()
  const theme = appearance.mode
  const setTheme = (mode: LingTheme) => { updateAppearance({ mode }) }
  const [selectionRestored, setSelectionRestored] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<readonly LingTaskSearchMatch[]>([])
  const [searchHasMore, setSearchHasMore] = useState(false)
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchMessage, setSearchMessage] = useState<string>()
  const [changes, setChanges] = useState<readonly LingTaskChanges[]>([])
  const [changesLoading, setChangesLoading] = useState(false)
  const [changesMessage, setChangesMessage] = useState<string>()
  const [selectedChange, setSelectedChange] = useState<ChangeSelection>()
  const [changeDiff, setChangeDiff] = useState<LingFileDiff>()
  const [changeDiffLoading, setChangeDiffLoading] = useState(false)
  const [changeDiffMessage, setChangeDiffMessage] = useState<string>()
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [busy, setBusy] = useState(false)
  const resending = useRef(false)
  const submitAttempts = useRef(new Map<string, { draft: Draft; text: string; run: RetryRunner }>())
  const [modelSettings, setModelSettings] = useState<LingModelSettings>()
  const [disabledModelKeys, setDisabledModelKeys] = useState<readonly string[]>(readDisabledModels)
  const [confirmedModelKeys, setConfirmedModelKeys] = useState<readonly string[]>(readConfirmedModels)
  const visibleModelSettings = useMemo(
    () => withModelVisibility(modelSettings, disabledModelKeys, confirmedModelKeys),
    [modelSettings, disabledModelKeys, confirmedModelKeys],
  )
  const [modelSettingsLoading, setModelSettingsLoading] = useState(false)
  const [modelSettingsMessage, setModelSettingsMessage] = useState<string>()
  const [permission, setPermission] = useState<LingTaskPermission>()
  const [newTaskAgentPreset, setNewTaskAgentPreset] = useState<string>()
  const [presetRevision, setPresetRevision] = useState(0)
  const [presetPending, setPresetPending] = useState(false)
  const [presetState, setPresetState] = useState<{ taskId?: string; catalog?: LingTaskAgentPreset; loading: boolean; error?: string }>({ loading: true })
  const [newTaskPermission, setNewTaskPermission] = useState<LingTaskPermission>()

  const [schedules, setSchedules] = useState<readonly LingTaskSchedule[]>()
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [schedulesMessage, setSchedulesMessage] = useState<string>()
  const [schedulesStamp, setSchedulesStamp] = useState(0)
  const [localePreference, setLocalePreferenceState] = useState<'zh' | 'en' | undefined>()
  const [localeLoading, setLocaleLoading] = useState(false)
  const [localeMessage, setLocaleMessage] = useState<string>()
  const {
    answerApproval,
    answerQuestion,
    authorizeProvider,
    backgroundJobs,
    cancelInteraction,
    cancelTask,
    connection,
    createCustomProvider,
    createWorkspace,
    deleteWorkspace,
    forkTask,
    getModelSettings,
    refreshProviderModels,
    getLocalePreference,
    getTaskAgentPresets,
    getTaskChanges,
    getTaskCommands,
    getPermissionCatalog,
    getTaskFileDiff,
    getTaskMode,
    getTaskPermissions,
    getTaskSchedules,
    getTaskSkills,
    getWorkspaceSkills,
    interruptSubagent,
    listPlugins,
    listWorkspaceDirectory,
    getWorkspaceBranch,
    workspaceGit,
    workspaceTools,
    loadOlder,
    loadTaskAttachment,
    pendingInteractions,
    pendingMessages,
    updateQueuedMessage,
    pickDirectory,
    promptSubagent,
    readWorkspaceDocument,
    saveWorkspaceDocument,
    listDraftWorkspaceDirectory,
    readDraftWorkspaceDocument,
    saveDraftWorkspaceDocument,
    refreshSubagents,
    reconnect: reconnectRuntime,
    removeProvider,
    renameTask,
    renameWorkspace,
    runCommand,
    runGoalAction,
    searchTasks,
    selectAgentPreset,
    selectDefaultModel,
    selectedTask,
    selectTask,
    selectTaskModel,
    setLocalePreference,
    setTaskArchived,
    deleteTask,
    signOutProvider,
    startNewTask: startNewTaskRuntime,
    storeProviderApiKey,
    subagents,
    submit: submitRuntime,
    supportsExtensions,
    supportsSubagents,
    supportsDirectoryPick,
    supportsSchedules,
    supportsTaskModel,
    supportsWorkspaceFiles,
    taskModel,
    tasks,
    testProvider,
    timeline,
    updateCustomProvider,
    workspaces,
  } = useLingRuntime(runtime)
  const resolvedSlots = useLingUiSlots(extensions, slots)
  const draftsRef = useRef(drafts)
  draftsRef.current = drafts
  const workspaceContextScopes = useRef(new Map<string, string>())

  const draftKey = selectedTask?.taskId ?? newTaskKey
  const draft = drafts[draftKey] ?? emptyDraft
  const newTaskContextScope = workspaceContextScope({
    workspaceId: newTaskServerId || newTaskWithoutWorkspace ? undefined : newTaskWorkspaceId ?? workspaces[0]?.workspaceId,
    serverId: newTaskServerId,
  })

  const updateDraftContextScope = useCallback((key: string, scope: string, added?: ComposerAttachment) => {
    const previous = workspaceContextScopes.current.get(key)
    const changed = previous !== undefined && previous !== scope
    workspaceContextScopes.current.set(key, scope)
    if (changed) {
      const attempt = submitAttempts.current.get(key)
      submitAttempts.current.delete(key)
      if (attempt) setRetryAction(current => current === attempt.run ? undefined : current)
    }
    setDrafts(current => {
      const previousDraft = current[key] ?? emptyDraft
      let attachments = previousDraft.attachments
      if (changed && attachments.some(item => item.context)) attachments = attachments.filter(item => !item.context)
      if (added?.context && !attachments.some(item => item.context && workspaceContextKey(item.context) === workspaceContextKey(added.context!))) {
        attachments = [...attachments, added]
      }
      if (attachments === previousDraft.attachments) return current
      return { ...current, [key]: { ...previousDraft, attachments } }
    })
  }, [])

  useEffect(() => {
    updateDraftContextScope(newTaskKey, newTaskContextScope)
  }, [newTaskContextScope, updateDraftContextScope])

  const syncWorkspaceContextScope = useCallback((scope: string) => {
    updateDraftContextScope(draftKey, scope)
  }, [draftKey, updateDraftContextScope])

  const writeDraft = useCallback((key: string, next: Partial<Draft>) => {
    setDrafts(current => ({
      ...current,
      [key]: { ...(current[key] ?? emptyDraft), ...next },
    }))
  }, [])

  const clearDraft = useCallback((key: string, submitted?: Draft) => {
    setDrafts(current => {
      const previous = current[key]
      const remaining = submitted && previous ? acceptDraft(previous, submitted) : undefined
      for (const attachment of previous?.attachments ?? []) {
        if (!remaining?.attachments.includes(attachment)) releaseComposerAttachment(attachment)
      }
      const next = { ...current }
      if (remaining) next[key] = remaining
      else delete next[key]
      return next
    })
  }, [])

  const running = selectedTask !== undefined
    && (selectedTask.status === 'running' || selectedTask.status === 'queued' || selectedTask.status === 'waiting-for-input')
  const taskInteractions = useMemo(
    () => pendingInteractions.filter(interaction => interaction.taskId === selectedTask?.taskId),
    [pendingInteractions, selectedTask?.taskId],
  )

  const refreshModelSettings = useCallback(async (signal?: AbortSignal) => {
    setModelSettingsLoading(true)
    try {
      const result = await getModelSettings(signal)
      if (signal?.aborted) return
      if (result.ok) {
        setModelSettings(result.value)
        setModelSettingsMessage(undefined)
      } else {
        setModelSettingsMessage(result.message)
      }
    } catch {
      if (!signal?.aborted) setModelSettingsMessage('无法读取模型设置。')
    } finally {
      if (!signal?.aborted) setModelSettingsLoading(false)
    }
  }, [getModelSettings])

  useEffect(() => {
    const abort = new AbortController()
    void refreshModelSettings(abort.signal)
    const unsubscribe = runtime.subscribeModelSettings(() => { void refreshModelSettings() })
    return () => {
      abort.abort()
      unsubscribe()
    }
  }, [refreshModelSettings, runtime])

  useEffect(() => {
    applyAppearance(appearance, appearance.resolved)
  }, [appearance.mode, appearance.palette, appearance.resolved, appearance.fontStyle, appearance.contentWidth, appearance.fileIcons, appearance.glass])

  useEffect(() => {
    const native = (window as Window & { __LING_THEME__?: { set: (appearance: { mode: LingTheme; palette: string }) => Promise<void> } }).__LING_THEME__
    void native?.set({ mode: appearance.mode, palette: appearance.palette }).catch(() => {})
  }, [appearance.mode, appearance.palette])

  useEffect(() => {
    if (!searchOpen) return
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      setSearchHasMore(false)
      setSearchMessage(undefined)
      setSearchLoading(false)
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      void searchTasks(query, abort.signal).then(result => {
        if (abort.signal.aborted) return
        if (result.ok) {
          setSearchResults(result.value.items)
          setSearchHasMore(result.value.hasMore)
          setSearchMessage(undefined)
        } else {
          setSearchResults([])
          setSearchHasMore(false)
          setSearchMessage(result.message)
        }
        setSearchLoading(false)
      }).catch(() => {
        if (!abort.signal.aborted) {
          setSearchResults([])
          setSearchHasMore(false)
          setSearchLoading(false)
          setSearchMessage('无法搜索任务。')
        }
      })
    }, 140)
    setSearchLoading(true)
    setSearchMessage(undefined)
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [searchTasks, searchOpen, searchQuery])

  const selectedTaskId = selectedTask?.taskId
  const selectedTaskStatus = selectedTask?.status

  useEffect(() => {
    const location: NavigationLocation = screen === 'settings'
      ? { screen, tab: settingsTab }
      : screen === 'knowledge' || screen === 'automation' ? { screen }
      : { screen, taskId: selectedTaskId }
    if (pendingNavigation.current) {
      if (sameLocation(pendingNavigation.current, location)) pendingNavigation.current = undefined
      return
    }
    setNavigation(current => {
      if (sameLocation(current.entries[current.index]!, location)) return current
      const entries = [...current.entries.slice(0, current.index + 1), location].slice(-50)
      return { entries, index: entries.length - 1 }
    })
  }, [screen, selectedTaskId, settingsTab])

  const refreshPermission = useCallback(async (taskId: string) => {
    try {
      const result = await getTaskPermissions(taskId)
      setPermission(result.ok && result.value.options.length > 0 ? result.value : undefined)
    } catch {
      setPermission(undefined)
    }
  }, [getTaskPermissions])

  useEffect(() => {
    if (selectedTaskId === undefined) {
      setPermission(undefined)
      return
    }
    void refreshPermission(selectedTaskId)
  }, [refreshPermission, selectedTaskId])

  useEffect(() => {
    let active = true
    void getPermissionCatalog().then(result => {
      if (!active) return
      if (!result.ok || result.value.length === 0) {
        setNewTaskPermission(undefined)
        return
      }
      setNewTaskPermission(current => ({
        options: result.value,
        currentValue: current?.currentValue && result.value.some(option => option.value === current.currentValue)
          ? current.currentValue
          : result.value.find(option => option.value === 'ask')?.value ?? result.value[0]?.value,
      }))
    }).catch(() => { if (active) setNewTaskPermission(undefined) })
    return () => { active = false }
  }, [getPermissionCatalog])

  const { mode, refreshMode } = useTaskMode(selectedTaskId, selectedTaskStatus, getTaskMode)


  useEffect(() => {
    setSchedules(undefined)
    setSchedulesMessage(undefined)
    if (selectedTaskId === undefined) {
      setSchedulesLoading(false)
      return
    }
    let active = true
    setSchedulesLoading(true)
    void getTaskSchedules(selectedTaskId).then(result => {
      if (!active) return
      if (result.ok) {
        setSchedules(result.value)
        setSchedulesMessage(undefined)
      } else {
        setSchedules(undefined)
        setSchedulesMessage(result.message)
      }
      setSchedulesLoading(false)
    }).catch(() => {
      if (!active) return
      setSchedules(undefined)
      setSchedulesLoading(false)
      setSchedulesMessage('无法读取定时提醒。')
    })
    return () => { active = false }
  }, [getTaskSchedules, schedulesStamp, selectedTaskId, selectedTaskStatus, timeline.length])

  useEffect(() => {
    window.localStorage.setItem(draftStorageKey, serializeDrafts(drafts))
  }, [drafts])

  useEffect(() => {
    if (selectionRestored || tasks.length === 0) return
    setSelectionRestored(true)
    const linked = new URL(window.location.href).searchParams.get('task')
    const stored = window.localStorage.getItem(selectedTaskStorageKey)
    const taskIds = tasks.map(task => task.taskId)
    const restore = pickRestorableTaskId(linked, taskIds) ?? pickRestorableTaskId(stored, taskIds)
    if (restore !== undefined) void selectTask(restore)
  }, [selectTask, selectionRestored, tasks])

  useEffect(() => {
    if (!selectionRestored) return
    if (selectedTaskId === undefined) window.localStorage.removeItem(selectedTaskStorageKey)
    else window.localStorage.setItem(selectedTaskStorageKey, selectedTaskId)
  }, [selectionRestored, selectedTaskId])

  const changesRevision = timeline.map(item => item.turnChangesSeq ?? '').join(',')
  useEffect(() => {
    setSelectedChange(undefined)
    setChangeDiff(undefined)
    setChangeDiffMessage(undefined)
    if (selectedTaskId === undefined) {
      setChanges([])
      setChangesLoading(false)
      setChangesMessage(undefined)
      return
    }
    const abort = new AbortController()
    setChangesLoading(true)
    setChangesMessage(undefined)
    void getTaskChanges(selectedTaskId, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) {
        setChanges(result.value)
        setChangesMessage(undefined)
      } else {
        setChanges([])
        setChangesMessage(result.message)
      }
      setChangesLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) {
        setChanges([])
        setChangesLoading(false)
        setChangesMessage('无法读取文件变更。')
      }
    })
    return () => { abort.abort() }
  }, [getTaskChanges, selectedTaskId, selectedTaskStatus, timeline.length, changesRevision])

  useEffect(() => {
    if (selectedTaskId === undefined || selectedChange === undefined) {
      setChangeDiff(undefined)
      setChangeDiffLoading(false)
      setChangeDiffMessage(undefined)
      return
    }
    const abort = new AbortController()
    setChangeDiff(undefined)
    setChangeDiffLoading(true)
    setChangeDiffMessage(undefined)
    void getTaskFileDiff(selectedTaskId, selectedChange.seq, selectedChange.index, abort.signal).then(result => {
      if (abort.signal.aborted) return
      if (result.ok) {
        setChangeDiff(result.value)
        setChangeDiffMessage(undefined)
      } else {
        setChangeDiff(undefined)
        setChangeDiffMessage(result.message)
      }
      setChangeDiffLoading(false)
    }).catch(() => {
      if (!abort.signal.aborted) {
        setChangeDiff(undefined)
        setChangeDiffLoading(false)
        setChangeDiffMessage('无法读取文件差异。')
      }
    })
    return () => { abort.abort() }
  }, [getTaskFileDiff, selectedChange, selectedTaskId])

  const report = useCallback((result: LingCommandResult, success: string, retry?: RetryRunner) => {
    // Store the callback; passing it directly makes React execute it as a state updater.
    setRetryAction(() => retryPending(result, retry) ? retry : undefined)
    setNotice(result.accepted ? (success || '') : result.message)
  }, [])

  const showNotice = useCallback((text: string) => {
    setRetryAction(undefined)
    setNotice(text)
  }, [])

  const retryNotice = useCallback(() => {
    if (retryAction) void retryAction()
  }, [retryAction])

  useEffect(() => {
    const taskId = selectedTask?.taskId
    let active = true
    let generation = 0
    const load = async () => {
      const request = ++generation
      setPresetState({ taskId, loading: true })
      try {
        const result = await getTaskAgentPresets(taskId)
        if (!active || request !== generation) return
        setPresetState(result.ok ? { taskId, loading: false, catalog: result.value } : { taskId, loading: false, error: result.message })
      } catch {
        if (active && request === generation) setPresetState({ taskId, loading: false, error: '无法读取智能体。' })
      }
    }
    if (connection.phase === 'ready') void load()
    window.addEventListener('focus', load)
    return () => { active = false; window.removeEventListener('focus', load) }
  }, [getTaskAgentPresets, selectedTask?.taskId, connection.phase, presetRevision])
  const presetCatalog = presetState.taskId === selectedTask?.taskId ? presetState.catalog : undefined
  const stagedPresetAvailable = presetCatalog?.options.some(preset => preset.id === newTaskAgentPreset && !preset.unavailableReason)
  const composerAgentPreset = selectedTask || presetCatalog?.modeSelectionEnabled === false ? presetCatalog?.currentValue : stagedPresetAvailable ? newTaskAgentPreset : presetCatalog?.currentValue
  const selectPresetAndRefresh = useCallback(async (taskId: string, id: string) => {
    const result = await selectAgentPreset(taskId, id)
    if (result.accepted) setPresetRevision(value => value + 1)
    return result
  }, [selectAgentPreset])
  const chooseComposerPreset = async (id: string) => {
    if (presetPending || presetCatalog?.modeSelectionEnabled === false || !presetCatalog?.options.some(option => option.id === id && !option.unavailableReason)) return
    if (!selectedTask) { setNewTaskAgentPreset(id); return }
    if (!selectedTask.blank) {
      setNewTaskAgentPreset(id)
      setNewTaskWorkspaceId(selectedTask.workspaceId)
      setNewTaskWithoutWorkspace(selectedTask.workspaceId === undefined)
      startNewTaskRuntime()
      showNotice('')
      return
    }
    setPresetPending(true)
    try {
      const result = await selectPresetAndRefresh(selectedTask.taskId, id)
      report(result, '')
    } catch { showNotice('无法切换智能体，请重试。') }
    finally { setPresetPending(false) }
  }

  const startNewTask = useCallback(() => {
    setNewTaskAgentPreset(undefined)
    setScreen('workspace')
    setNewTaskWorkspaceId(undefined)
    setNewTaskServerId(undefined)
    setNewTaskOperationsServerId(undefined)
    setNewTaskWithoutWorkspace(false)
    startNewTaskRuntime()
    showNotice('')
  }, [showNotice, startNewTaskRuntime])

  const startNewTaskInWorkspace = useCallback((workspaceId: string) => {
    setScreen('workspace')
    setNewTaskWorkspaceId(workspaceId)
    setNewTaskServerId(undefined)
    setNewTaskOperationsServerId(undefined)
    setNewTaskWithoutWorkspace(false)
    startNewTaskRuntime()
    showNotice('')
  }, [showNotice, startNewTaskRuntime])

  const startNewTaskWithoutWorkspace = useCallback(() => {
    setScreen('workspace')
    setNewTaskWorkspaceId(undefined)
    setNewTaskServerId(undefined)
    setNewTaskOperationsServerId(undefined)
    setNewTaskWithoutWorkspace(true)
    startNewTaskRuntime()
    showNotice('')
  }, [showNotice, startNewTaskRuntime])

  const startNewTaskOnServer = useCallback((serverId: string) => {
    setScreen('workspace')
    setNewTaskWorkspaceId(undefined)
    setNewTaskWithoutWorkspace(false)
    setNewTaskServerId(serverId)
    setNewTaskOperationsServerId(undefined)
    startNewTaskRuntime()
    showNotice('')
  }, [showNotice, startNewTaskRuntime])

  const selectOperationsServer = useCallback(async (serverId: string): Promise<boolean> => {
    if (!selectedTask) { setNewTaskOperationsServerId(serverId); return true }
    if (!runtime.serverManager) { showNotice('服务器服务暂时不可用。'); return false }
    try {
      const home = await readyServerHome(serverId)
      const result = await runtime.serverManager.attachOperations(selectedTask.taskId, serverId, home)
      if (!result.ok) { showNotice(result.message); return false }
      showNotice('')
      return true
    } catch (error) {
      showNotice(error instanceof Error ? error.message : '服务器连接失败。')
      return false
    }
  }, [runtime.serverManager, selectedTask, showNotice])

  const openSettings = useCallback((tab: LingSettingsTab = 'general') => {
    showNotice('')
    setSettingsTab(tab)
    setScreen('settings')
  }, [showNotice])

  const addFiles = useCallback((files: File[]) => {
    const key = draftKey
    void Promise.all(files.map(file => toComposerAttachment(file))).then(attachments => {
      const current = draftsRef.current[key] ?? emptyDraft
      writeDraft(key, { attachments: [...current.attachments, ...attachments] })
    }).catch(() => {
      showNotice('部分附件无法读取。')
    })
  }, [draftKey, showNotice, writeDraft])

  const addWorkspaceContext = useCallback((reference: WorkspaceContextReference, scope?: string) => {
    const resolvedScope = scope ?? (selectedTask
      ? workspaceContextScopes.current.get(draftKey) ?? workspaceContextScope({ workspaceId: selectedTask.workspaceId })
      : newTaskContextScope)
    updateDraftContextScope(draftKey, resolvedScope, toComposerWorkspaceContext(reference))
    setComposerFocusKey(key => key + 1)
  }, [draftKey, newTaskContextScope, selectedTask, updateDraftContextScope])

  useBehaviorNotifications(tasks, pendingInteractions, behavior, showNotice)
  useEffect(() => nativeBehavior()?.onOpenTask(taskId => { setScreen('workspace'); void selectTask(taskId) }), [selectTask])

  const submit = useCallback(async (textOverride?: string, onAccepted?: () => void) => {
    if (presetPending) return
    const text = (textOverride ?? draft.text).trim()
    const attachments = draft.attachments
    if (!text && attachments.length === 0 && !draft.recordedAttachments?.attachments.length) return
    if (/^\/(goal|plan)(?:\s|$)/u.test(text) && (attachments.length > 0 || !!draft.recordedAttachments?.attachments.length)) {
      showNotice('目标与计划指令暂不支持附件，请移除附件后重试。')
      return
    }
    const previousAttempt = submitAttempts.current.get(draftKey)
    if (previousAttempt?.draft === draft && previousAttempt.text === text) {
      try { await previousAttempt.run() } catch { showNotice('无法发送，请检查运行状态后重试。') }
      return
    }
    const payload = attachments.map(attachment => attachment.attachment)
    const attemptId = crypto.randomUUID()
    let inFlight: Promise<LingCommandResult> | undefined
    try {
      const execute: RetryRunner = async () => {
        // DSH claims registered commands only. /skill-name remains a user prompt,
        // so tool-skill can resolve and inject its real instructions server-side.
        let commandMatch = false
        if (selectedTask && text.startsWith('/')) {
          const catalog = await getTaskCommands(selectedTask.taskId)
          if (!catalog.ok) throw new Error(catalog.message)
          commandMatch = isComposerCommand(text, catalog.value)
          if (commandMatch && (payload.length || draft.recordedAttachments?.attachments.length)) {
            const rejected: LingCommandResult = { accepted: false, requestId: attemptId, reason: 'invalid-command', message: '该指令暂不支持附件，请移除附件后重试。', retryable: false }
            report(rejected, '')
            return rejected
          }
        }
        const result = selectedTask && commandMatch
          ? await runCommand(selectedTask.taskId, text, runtime.supportsGoalLimit ? behavior.goalRounds : undefined, attemptId)
          : await submitRuntime(text, {
            requestId: attemptId,
            ...(draft.recordedAttachments?.attachments.length ? { recordedAttachments: { seq: draft.recordedAttachments.seq, attachmentIds: draft.recordedAttachments.attachments.map(a => a.attachmentId) } } : {}),
            ...(runtime.supportsGoalLimit ? { maxGoalRounds: behavior.goalRounds } : {}),
            ...(selectedTask && running ? { mode: 'queue' as const } : {}),
            ...(payload.length > 0 ? { attachments: payload } : {}),
            ...(selectedTask === undefined && !newTaskServerId && !newTaskWithoutWorkspace && (newTaskWorkspaceId ?? workspaces[0]?.workspaceId) ? { workspaceId: newTaskWorkspaceId ?? workspaces[0]?.workspaceId } : {}),
            ...(selectedTask === undefined && newTaskServerId ? { serverId: newTaskServerId } : {}),
            ...(selectedTask === undefined && newTaskOperationsServerId ? { operationsServerId: newTaskOperationsServerId } : {}),
            ...(selectedTask === undefined && composerAgentPreset ? { agentPreset: composerAgentPreset } : {}),
            ...(selectedTask === undefined && newTaskPermission?.currentValue ? { permissionPreset: newTaskPermission.currentValue } : {}),
          })
        report(result, '', action)
        if (result.accepted) {
          if (!selectedTask) {
            try { rememberCreatedTaskMode(result, behavior.workMode) }
            catch { showNotice('消息已发送，但任务所属模式未能保存；仍可在全部任务中找到。') }
          }
          if (submitAttempts.current.get(draftKey)?.run === action) submitAttempts.current.delete(draftKey)
          clearDraft(draftKey, draft)
          onAccepted?.()
          if (!selectedTask) setNewTaskAgentPreset(undefined)
          setNewTaskWorkspaceId(undefined)
          setNewTaskServerId(undefined)
          setNewTaskOperationsServerId(undefined)
          setNewTaskWithoutWorkspace(false)
          if (selectedTask && text.startsWith('/')) void refreshMode(selectedTask.taskId)
        }
        return result
      }
      const action: RetryRunner = () => inFlight ??= execute().finally(() => { inFlight = undefined })
      submitAttempts.current.set(draftKey, { draft, text, run: action })
      await action()
    } catch {
      showNotice('无法发送，请检查运行状态后重试。')
    }
  }, [presetPending, composerAgentPreset, getTaskCommands, behavior.goalRounds, behavior.workMode, runtime, clearDraft, draft, draftKey, newTaskAgentPreset, newTaskPermission, newTaskWorkspaceId, newTaskServerId, newTaskOperationsServerId, newTaskWithoutWorkspace, refreshMode, report, runCommand, running, selectedTask, showNotice, submitRuntime, workspaces])

  const stop = useCallback(async () => {
    if (!selectedTask) return
    const result = await cancelTask(selectedTask.taskId)
    report(result, '已请求停止。')
  }, [cancelTask, report, selectedTask])

  const sendSubagentPrompt = useCallback(async (subagentSessionId: string, text: string) => {
    const result = await promptSubagent(subagentSessionId, text)
    return result.ok ? { accepted: true } : { accepted: false, message: result.message }
  }, [promptSubagent])

  const stopSubagent = useCallback(async (subagentSessionId: string) => {
    const result = await interruptSubagent(subagentSessionId)
    return result.ok ? { accepted: true } : { accepted: false, message: result.message }
  }, [interruptSubagent])

  useEffect(() => {
    let active = true
    setLocaleLoading(true)
    void getLocalePreference().then(result => {
      if (!active) return
      if (result.ok) {
        setLocalePreferenceState(result.value.preference)
        setLocaleMessage(undefined)
      } else {
        setLocaleMessage(result.message)
      }
      setLocaleLoading(false)
    })
    return () => { active = false }
  }, [getLocalePreference])

  const changeLocalePreference = useCallback((preference: 'zh' | 'en' | undefined) => {
    setLocaleLoading(true)
    setLocaleMessage(undefined)
    void setLocalePreference(preference).then(result => {
      if (result.ok) setLocalePreferenceState(preference)
      else setLocaleMessage(result.message)
      setLocaleLoading(false)
    })
  }, [setLocalePreference])

  const selectPermission = useCallback(async (value: string) => {
    if (!selectedTask) {
      setNewTaskPermission(current => current ? { ...current, currentValue: value } : current)
      return
    }
    const result = await runCommand(selectedTask.taskId, `/permission ${value}`)
    report(result, '')
    if (result.accepted) await refreshPermission(selectedTask.taskId)
  }, [refreshPermission, report, runCommand, selectedTask])

  const togglePlanMode = useCallback(async (active: boolean) => {
    if (!selectedTask) return
    const result = await runCommand(selectedTask.taskId, active ? '/plan' : '/plan off')
    report(result, '')
    if (result.accepted) await refreshMode(selectedTask.taskId)
  }, [refreshMode, report, runCommand, selectedTask])

  const compactContext = useCallback(async () => {
    if (!selectedTask) return
    const catalog = await getTaskCommands(selectedTask.taskId)
    if (!catalog.ok || !catalog.value.some(command => command.name === 'compact')) {
      showNotice(catalog.ok ? '当前运行时不支持压缩上下文。' : catalog.message)
      return
    }
    const result = await runCommand(selectedTask.taskId, '/compact')
    report(result, '已请求压缩上下文。')
  }, [getTaskCommands, report, runCommand, selectedTask, showNotice])

  const applyGoalAction = useCallback(async (
    action: 'pause' | 'resume' | 'complete' | 'clear',
    goal: LingTaskGoal,
  ) => {
    if (!selectedTask) return
    const result = await runGoalAction(selectedTask.taskId, action, goal)
    report(result, '')
    if (result.accepted) await refreshMode(selectedTask.taskId)
  }, [refreshMode, report, runGoalAction, selectedTask])

  const loadOlderHistory = useCallback(async () => {
    if (!selectedTask || loadingOlder) return
    setLoadingOlder(true)
    try {
      const result = await loadOlder(selectedTask.taskId)
      report(result, '')
    } finally {
      setLoadingOlder(false)
    }
  }, [loadOlder, loadingOlder, report, selectedTask])

  const reconnect = useCallback(async () => {
    const result = await reconnectRuntime()
    report(result, '正在重新连接…')
  }, [reconnectRuntime, report])

  const fork = useCallback(async (taskId: string, atSeq?: number) => {
    if (busy) return
    setBusy(true)
    const workMode = readTaskWorkModes()[taskId] ?? behavior.workMode
    try {
      const action: RetryRunner = async () => {
        const result = await forkTask(taskId, atSeq)
        report(result, '已创建分叉任务。', action)
        try { rememberCreatedTaskMode(result, workMode) }
        catch { showNotice('分叉已创建，但任务所属模式未能保存。') }
        return result
      }
      await action()
    } finally {
      setBusy(false)
    }
  }, [busy, forkTask, report, behavior.workMode, showNotice])

  const resend = useCallback(async (item: LingTimelineItem) => {
    if (resending.current) throw new Error('正在重发消息，请稍候。')
    resending.current = true
    try { await resendMessage(runtime, item) }
    finally { resending.current = false }
  }, [runtime])

  const editMessage = useCallback((item: LingTimelineItem) => {
    writeDraft(item.taskId, { text: item.text, recordedAttachments: item.seq !== undefined && item.attachments?.length ? { seq: item.seq, attachments: item.attachments } : undefined })
    setComposerFocusKey(key => key + 1)
    showNotice('')
  }, [writeDraft, showNotice])

  const withdrawQueue = useCallback(async (itemId: string): Promise<LingCommandResult> => {
    const requestId = crypto.randomUUID()
    const taskId = selectedTask?.taskId
    if (!taskId || !runtime.withdrawQueuedMessage) return { accepted: false, requestId, reason: 'runtime-unavailable', message: '队列服务暂不可用。', retryable: true }
    const before = draftsRef.current[taskId] ?? emptyDraft
    const result = await runtime.withdrawQueuedMessage(taskId, itemId)
    if (!result.ok) return { accepted: false, requestId, reason: result.reason, message: result.message, retryable: result.retryable }
    setDrafts(current => {
      const latest = current[taskId] ?? emptyDraft
      // Editing replaces the current text, as in Qoder. Typing that arrived
      // while the Host was responding must still survive the async operation.
      const text = latest.text !== before.text && latest.text
        ? [result.value.text, latest.text].filter(Boolean).join('\n') : result.value.text
      return { ...current, [taskId]: { ...latest, text, recordedAttachments: result.value.recordedAttachments } }
    })
    setComposerFocusKey(key => key + 1)
    showNotice('')
    return { accepted: true, requestId }
  }, [runtime, selectedTask?.taskId, showNotice])

  const reorderQueue = useCallback(async (itemIds: readonly string[]): Promise<LingCommandResult> => {
    const requestId = crypto.randomUUID()
    if (!selectedTask || !runtime.reorderQueuedMessages) return { accepted: false, requestId, reason: 'runtime-unavailable', message: '队列服务暂不可用。', retryable: true }
    const result = await runtime.reorderQueuedMessages(selectedTask.taskId, itemIds)
    return result.ok ? { accepted: true, requestId } : { accepted: false, requestId, reason: result.reason, message: result.message, retryable: result.retryable }
  }, [runtime, selectedTask])

  const addQuote = useCallback((text: string, preview: string) => {
    const current = draftsRef.current[draftKey] ?? emptyDraft
    writeDraft(draftKey, { attachments: [...current.attachments, toComposerQuote(text, preview)] })
  }, [draftKey, writeDraft])

  const rename = useCallback(async (taskId: string, title: string) => {
    const result = await renameTask(taskId, title)
    if (result.accepted) clearDraft(taskId)
    return result
  }, [clearDraft, renameTask])

  const exportTask = useCallback(async (task: LingTaskSummary) => {
    try {
      const items = await runtime.getTaskTimeline(task.taskId)
      const lines = [
        `# ${task.title}`,
        '',
        `- 任务 ID：${task.taskId}`,
        `- 最近更新：${task.updatedAt}`,
        '',
        ...items.flatMap(item => [
          `## ${item.title ?? item.kind} · ${item.createdAt}`,
          '',
          item.text,
          ...(item.detail ? ['', item.detail] : []),
          '',
        ]),
      ]
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${task.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || 'task'}-${task.taskId.slice(0, 8)}.md`
      link.click()
      window.setTimeout(() => { URL.revokeObjectURL(url) }, 1000)
    } catch {
      showNotice('导出记录失败，请重试。')
    }
  }, [runtime, showNotice])

  const toggleArchive = useCallback(async (taskId: string, archived: boolean) => {
    const action: RetryRunner = async () => {
      const result = await setTaskArchived(taskId, archived)
      if (result.accepted) {
        if (archived) { if (taskId === selectedTaskId) startNewTaskRuntime() }
        else { void selectTask(taskId) }
      }
      report(result, archived ? '' : '任务已恢复。', action)
      return result
    }
    await action()
  }, [report, selectTask, selectedTaskId, setTaskArchived, startNewTaskRuntime])

  const answerQuestionTo = useCallback(async (interactionId: string, answers: readonly LingQuestionAnswer[]) => {
    const result = await answerQuestion(interactionId, answers)
    report(result, '')
  }, [answerQuestion, report])

  const approveInteraction = useCallback(async (interactionId: string, decision: 'allowed-once' | 'rejected') => {
    const result = await answerApproval(interactionId, decision)
    report(result, '')
  }, [answerApproval, report])

  const cancelPendingInteraction = useCallback(async (interactionId: string) => {
    const result = await cancelInteraction(interactionId)
    report(result, '')
  }, [cancelInteraction, report])

  const openWorkspaceScreen = useCallback(() => { setScreen('workspace') }, [])
  const openAutomationScreen = useCallback(() => { setSearchOpen(false); setScreen('automation') }, [])
  const openKnowledgeScreen = useCallback(() => { setSearchOpen(false); setScreen('knowledge') }, [])

  const openSearch = useCallback(() => { setSearchOpen(true) }, [])
  const closeSearch = useCallback(() => {
    setSearchOpen(false)
    setSearchLoading(false)
  }, [])
  const selectSearchResult = useCallback((taskId: string) => {
    setScreen('workspace')
    setNewTaskWorkspaceId(undefined)
    selectTask(taskId)
    setSearchOpen(false)
    showNotice('')
  }, [selectTask, showNotice])
  const selectSidebarTask = useCallback((taskId: string) => {
    setScreen('workspace')
    setNewTaskWorkspaceId(undefined)
    selectTask(taskId)
  }, [selectTask])
  const toggleBrowser = useCallback(() => {
    const next = !browserOpen
    setBrowserOpen(next)
    storeBrowserOpen(next)
  }, [browserOpen])

  const selectChangeAt = useCallback((selection: ChangeSelection) => {
    setSelectedChange(selection)
  }, [])
  const closeChangeDiff = useCallback(() => { setSelectedChange(undefined) }, [])

  const saveDefaultModel = useCallback(async (selection: LingModelSelection) => {
    const result = await selectDefaultModel(selection)
    if (result.accepted) await refreshModelSettings()
    else showNotice(result.message)
    return result
  }, [refreshModelSettings, selectDefaultModel, showNotice])

  const changeModelEnabled = useCallback(async (selection: LingModelSelection, enabled: boolean): Promise<string | undefined> => {
    const key = modelVisibilityKey(selection)
    const next = enabled
      ? disabledModelKeys.filter(candidate => candidate !== key)
      : [...new Set([...disabledModelKeys, key])]
    if (!enabled && modelSettings?.defaultSelection.provider === selection.provider && modelSettings.defaultSelection.model === selection.model) {
      const fallback = replacementDefaultModel(modelSettings, next, confirmedModelKeys)
      if (!fallback) return '请先启用并连接另一个模型，再停用当前默认模型。'
      const result = await saveDefaultModel(fallback)
      if (!result.accepted) return result.message
    }
    if (!saveDisabledModels(next)) return '无法保存模型启用状态。'
    if (enabled && modelSettings?.providers.find(provider => provider.providerId === selection.provider)?.models.find(model => model.id === selection.model)?.catalogUnverified) {
      const confirmed = [...new Set([...confirmedModelKeys, key])]
      if (!saveConfirmedModels(confirmed)) { saveDisabledModels(disabledModelKeys); return '无法保存模型启用状态。' }
      setConfirmedModelKeys(confirmed)
    }
    setDisabledModelKeys(next)
    return undefined
  }, [disabledModelKeys, confirmedModelKeys, modelSettings, saveDefaultModel])

  const taskModelScoped = selectedTask !== undefined && supportsTaskModel

  const selectComposerModel = useCallback(async (selection: LingModelSelection) => {
    if (selectedTask !== undefined && supportsTaskModel) {
      const result = await selectTaskModel(selectedTask.taskId, selection)
      if (!result.accepted) showNotice(result.message)
      return result
    }
    return await saveDefaultModel(selection)
  }, [saveDefaultModel, selectTaskModel, selectedTask, showNotice, supportsTaskModel])

  const saveProviderApiKey = useCallback(async (providerId: string, apiKey: string) => {
    const result = await storeProviderApiKey(providerId, apiKey)
    if (result.accepted) await refreshModelSettings()
    return result
  }, [refreshModelSettings, storeProviderApiKey])

  const loginProvider = useCallback(async (
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ) => {
    const result = await authorizeProvider(providerId, interaction, signal)
    if (result.ok && result.value === 'authorized') await refreshModelSettings()
    return result
  }, [authorizeProvider, refreshModelSettings])

  const logoutProvider = useCallback(async (providerId: string) => {
    const result = await signOutProvider(providerId)
    if (result.ok) await refreshModelSettings()
    return result
  }, [refreshModelSettings, signOutProvider])

  const addCustomProvider = useCallback(async (provider: LingCustomProviderDraft) => {
    const result = await createCustomProvider(provider)
    if (result.accepted) await refreshModelSettings()
    return result
  }, [createCustomProvider, refreshModelSettings])

  const editCustomProvider = useCallback(async (provider: LingCustomProviderDraft) => {
    const result = await updateCustomProvider(provider)
    if (result.accepted) await refreshModelSettings()
    return result
  }, [refreshModelSettings, updateCustomProvider])

  const discardProvider = useCallback(async (providerId: string) => {
    const result = await removeProvider(providerId)
    if (result.accepted) await refreshModelSettings()
    return result
  }, [refreshModelSettings, removeProvider])

  const createWorkspaceFromPath = useCallback(async (path: string, name?: string) => {
    const result = await createWorkspace(path)
    if (!result.accepted) return result
    if (name) {
      // Use the Host's identity: its canonical path can differ from the picker path.
      const workspaceId = result.output?.workspaceId ?? (await runtime.getSnapshot()).workspaces.find(workspace => workspace.locationLabel === path)?.workspaceId
      if (!workspaceId) {
        showNotice('工作区已添加，但尚未获取到工作区标识，名称未更新。')
        return result
      }
      const renamed = await renameWorkspace(workspaceId, name)
      if (!renamed.accepted) {
        showNotice(`工作区已添加，但名称未更新：${renamed.message}`)
        return result
      }
    }
    showNotice('工作区已添加。')
    return result
  }, [createWorkspace, renameWorkspace, runtime, showNotice])

  const selectWorkspacePath = useCallback(async (path: string): Promise<LingCommandResult> => {
    try {
      let snapshot = await runtime.getSnapshot()
      let workspace = snapshot.workspaces.find(item => item.locationLabel === path)
      if (!workspace) {
        const result = await createWorkspace(path)
        if (!result.accepted) return result
        snapshot = await runtime.getSnapshot()
        workspace = snapshot.workspaces.find(item => result.output?.workspaceId ? item.workspaceId === result.output.workspaceId : item.locationLabel === path)
      }
      if (!workspace) return { accepted: false, requestId: 'worktree-select', reason: 'runtime-unavailable', message: '工作区已添加，但尚未出现在列表中，请重试。', retryable: true }
      startNewTaskInWorkspace(workspace.workspaceId)
      return { accepted: true, requestId: 'worktree-select' }
    } catch { return { accepted: false, requestId: 'worktree-select', reason: 'runtime-unavailable', message: '无法切换工作区，请重试。', retryable: true } }
  }, [runtime, createWorkspace, startNewTaskInWorkspace])

  const removeWorkspace = useCallback(async (workspaceId: string) => {
    const result = await deleteWorkspace(workspaceId)
    if (result.accepted) {
      showNotice('工作区已移除。')
      setNewTaskWorkspaceId(current => current === workspaceId ? undefined : current)
      if (selectedTask?.workspaceId === workspaceId) startNewTaskRuntime()
    }
    return result
  }, [deleteWorkspace, selectedTask?.workspaceId, showNotice, startNewTaskRuntime])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) {
        if (event.key === 'Escape' && searchOpen) closeSearch()
        return
      }
      if (document.querySelector('[role="dialog"]:not(.task-search)')) return
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault()
        setSearchOpen(false)
        startNewTask()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [closeSearch, searchOpen, startNewTask])

  const setAppTheme = useCallback((next: LingTheme) => { setTheme(next) }, [])

  const onSettingsOpen = useCallback(() => { openSettings('general') }, [openSettings])

  const navigateHistory = useCallback((step: -1 | 1) => {
    const index = navigation.index + step
    const destination = navigation.entries[index]
    if (!destination) return
    pendingNavigation.current = destination
    setNavigation(current => ({ ...current, index }))
    closeSearch()
    if (destination.screen === 'settings') {
      setSettingsTab(destination.tab)
      setScreen('settings')
    } else if (destination.screen === 'knowledge' || destination.screen === 'automation') {
      setScreen(destination.screen)
    } else if (destination.taskId) {
      setScreen('workspace')
      selectTask(destination.taskId)
    } else {
      startNewTask()
    }
  }, [closeSearch, navigation, selectTask, startNewTask])

  const extensionReads = useMemo<LingExtensionProps | undefined>(() => supportsExtensions ? {
    settings: runtime.extensionSettings,
    manager: runtime.pluginManager,
    onSettingsChanged: async settings => {
      setNewTaskAgentPreset(undefined)
      setPresetRevision(value => value + 1)
      const effectiveDefault = settings.presets.find(preset => preset.isDefault)?.id
      if (selectedTask?.blank && effectiveDefault) {
        const result = await selectPresetAndRefresh(selectedTask.taskId, effectiveDefault)
        if (!result.accepted) throw new Error(result.message)
      }
    },
    onCreatePreset: id => {
      startNewTask()
      setNewTaskAgentPreset(id)
    },
    listPlugins,
    onSelectPreset: selectPresetAndRefresh,
    readAgentPresets: getTaskAgentPresets,
    readSkills: getTaskSkills,
    readWorkspaceSkills: getWorkspaceSkills,
  } : undefined, [
    runtime.pluginManager, runtime.extensionSettings, selectedTask, startNewTask,
    getTaskAgentPresets,
    getTaskSkills,
    getWorkspaceSkills,
    listPlugins,
    selectPresetAndRefresh,
    supportsExtensions,
  ])

  return (
    <LingShell
      replyFeatures={runtime.replyFeatures}
      automation={runtime.automation}
      hooks={runtime.hooks}
      knowledge={runtime.knowledge}
      evolution={runtime.evolution}
      sideTaskRuntime={runtime}
      computerControl={runtime.computerControl}
      serverManager={runtime.serverManager}
      composerAgentPreset={composerAgentPreset}
      composerPresetPending={presetPending}
      agentPresetControl={supportsExtensions ? <AgentPresetPicker catalog={presetCatalog} value={selectedTask ? undefined : composerAgentPreset} editable={!selectedTask || selectedTask.blank === true} loading={presetState.loading || presetState.taskId !== selectedTask?.taskId} pending={presetPending} error={presetState.taskId === selectedTask?.taskId ? presetState.error : undefined} onSelect={id => { void chooseComposerPreset(id) }} onRetry={() => setPresetRevision(value => value + 1)} /> : undefined}
      attachments={draft.attachments}
      recordedAttachments={draft.recordedAttachments?.attachments}
      onRemoveRecordedAttachment={id => writeDraft(draftKey, { recordedAttachments: draft.recordedAttachments ? { ...draft.recordedAttachments, attachments: draft.recordedAttachments.attachments.filter(a => a.attachmentId !== id) } : undefined })}
      composerFocusKey={composerFocusKey}
      changeDiff={changeDiff}
      changeDiffLoading={changeDiffLoading}
      changeDiffMessage={changeDiffMessage}
      changes={changes}
      changesLoading={changesLoading}
      changesMessage={changesMessage}
      connection={connection}
      demo={runtime.kind === 'offline-demo'}
      browserOpen={browserOpen}
      extensions={extensionReads}
      getTaskCommands={getTaskCommands}
      hasOlder={selectedTask?.hasOlder === true}
      loadingOlder={loadingOlder}
      loadAttachment={loadTaskAttachment}
      loadWorkspaceDirectory={listWorkspaceDirectory}
      loadWorkspaceBranch={getWorkspaceBranch}
      supportsGoalLimit={runtime.supportsGoalLimit}
      workspaceGit={workspaceGit}
      workspaceTools={workspaceTools}
      loadWorkspaceDocument={readWorkspaceDocument}
      saveWorkspaceDocument={runtime.saveWorkspaceDocument ? saveWorkspaceDocument : undefined}
      listDraftWorkspaceDirectory={runtime.listDraftWorkspaceDirectory ? listDraftWorkspaceDirectory : undefined}
      readDraftWorkspaceDocument={runtime.readDraftWorkspaceDocument ? readDraftWorkspaceDocument : undefined}
      saveDraftWorkspaceDocument={runtime.saveDraftWorkspaceDocument ? saveDraftWorkspaceDocument : undefined}
      modelSettings={visibleModelSettings}
      modelSettingsLoading={modelSettingsLoading}
      modelSettingsMessage={modelSettingsMessage}
      mode={mode}
      notice={notice}
      pendingInteractions={taskInteractions}
      pendingMessages={pendingMessages}
      onQueueAction={updateQueuedMessage}
      onQueueWithdraw={runtime.withdrawQueuedMessage ? withdrawQueue : undefined}
      onQueueReorder={runtime.reorderQueuedMessages ? reorderQueue : undefined}
      permission={selectedTask ? permission : newTaskPermission}
      prompt={draft.text}
      running={running}
      screen={screen}
      canNavigateBack={navigation.index > 0}
      canNavigateForward={navigation.index < navigation.entries.length - 1}
      searchHasMore={searchHasMore}
      searchLoading={searchLoading}
      searchMessage={searchMessage}
      searchOpen={searchOpen}
      searchQuery={searchQuery}
      searchResults={searchResults}
      selectedChange={selectedChange}
      selectedTask={selectedTask}
      settingsTab={settingsTab}
      slots={resolvedSlots}
      supportsWorkspaceFiles={supportsWorkspaceFiles}
      backgroundJobs={backgroundJobs}
      onSubagentsRefresh={() => { void refreshSubagents() }}
      onSubagentPrompt={runtime.promptTaskSubagent !== undefined ? sendSubagentPrompt : undefined}
      onSubagentInterrupt={runtime.interruptTaskSubagent !== undefined ? stopSubagent : undefined}
      subagents={subagents}
      supportsSubagents={supportsSubagents}
      schedules={schedules}
      schedulesLoading={schedulesLoading}
      schedulesMessage={schedulesMessage}
      supportsSchedules={supportsSchedules}
      onSchedulesRefresh={() => { setSchedulesStamp(current => current + 1) }}
      terminalService={runtime.terminalService}
      taskModel={taskModel}
      taskModelScoped={taskModelScoped}
      tasks={tasks}
      theme={theme}
      localePreference={localePreference}
      localeLoading={localeLoading}
      localeMessage={localeMessage}
      onLocaleChange={changeLocalePreference}
      timeline={timeline}
      version={LING_RENDERER_VERSION}
      workspaces={workspaces}
      onAddFiles={addFiles}
      onAddWorkspaceContext={addWorkspaceContext}
      onWorkspaceContextScopeChange={syncWorkspaceContextScope}
      onAddQuote={addQuote}
      onAnswerQuestion={answerQuestionTo}
      onApprove={approveInteraction}
      onCancelInteraction={cancelPendingInteraction}
      onChangeDiffClose={closeChangeDiff}
      onChangeSelect={selectChangeAt}
      onSelectWorkspacePath={selectWorkspacePath}
      onCreateWorkspace={createWorkspaceFromPath}
      onPickDirectory={supportsDirectoryPick ? pickDirectory : undefined}
      onPlanModeToggle={(active) => { void togglePlanMode(active) }}
      onCompactContext={() => { void compactContext() }}
      onDeleteWorkspace={removeWorkspace}
      onExportTask={task => { void exportTask(task) }}
      onBrowserToggle={toggleBrowser}
      onGoalAction={(action, goal) => { void applyGoalAction(action, goal) }}
      onFork={fork}
      onEditMessage={editMessage}
      onRetryMessage={resend}
      onLoadOlder={() => { void loadOlderHistory() }}
      onModelDefaultSelect={saveDefaultModel}
      onModelEnabledChange={changeModelEnabled}
      onModelSelect={selectComposerModel}
      onModelSettingsRefresh={() => { void refreshModelSettings() }}
      onProviderModelsRefresh={async providerId => { const result = await refreshProviderModels(providerId); await refreshModelSettings(); return result }}
      onNewTask={startNewTask}
      onNewTaskInWorkspace={startNewTaskInWorkspace}
      onNewTaskOnServer={startNewTaskOnServer}
      onSelectOperationsServer={selectOperationsServer}
      onClearOperationsServer={() => { setNewTaskOperationsServerId(undefined) }}
      onNewTaskWithoutWorkspace={startNewTaskWithoutWorkspace}
      newTaskWorkspaceId={newTaskWorkspaceId}
      newTaskServerId={newTaskServerId}
      newTaskOperationsServerId={newTaskOperationsServerId}
      newTaskWithoutWorkspace={newTaskWithoutWorkspace}
      onNavigateBack={() => { navigateHistory(-1) }}
      onNavigateForward={() => { navigateHistory(1) }}
      onNoticeRetry={retryAction ? retryNotice : undefined}
      onPromptChange={value => {
        writeDraft(draftKey, { text: value, ...(!value && !draft.recordedAttachments?.attachments.length && !draft.attachments.length ? { recordedAttachments: undefined } : {}) })
        showNotice('')
      }}
      onProviderCreate={addCustomProvider}
      onProviderDelete={discardProvider}
      onProviderAuthorize={loginProvider}
      onProviderSaveApiKey={saveProviderApiKey}
      onProviderSignOut={logoutProvider}
      onProviderTest={testProvider}
      onProviderUpdate={editCustomProvider}
      onReconnect={() => { void reconnect() }}
      onRemoveAttachment={id => {
        writeDraft(draftKey, {
          attachments: draft.attachments.filter(attachment => {
            if (attachment.id !== id) return true
            releaseComposerAttachment(attachment)
            return false
          }),
        })
      }}
      onRenameTask={rename}
      onRenameWorkspace={renameWorkspace}
      onSearchClose={closeSearch}
      onSearchOpen={openSearch}
      onSearchQueryChange={value => { setSearchQuery(value) }}
      onSearchSelect={selectSearchResult}
      onSelectPermission={value => { void selectPermission(value) }}
      onSelectTask={selectSidebarTask}
      onSettingsOpen={onSettingsOpen}
      onSettingsTabChange={setSettingsTab}
      onSubmit={(textOverride, onAccepted) => { void submit(textOverride, onAccepted) }}
      onStop={() => { void stop() }}
      onThemeChange={setAppTheme}
      onDeleteTask={deleteTask}
      onToggleTaskArchive={(taskId, archived) => { void toggleArchive(taskId, archived) }}
      onWorkspaceOpen={openWorkspaceScreen}
      onKnowledgeOpen={openKnowledgeScreen}
      onAutomationOpen={openAutomationScreen}
    />
  )
}
