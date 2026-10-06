import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  LingGitRequest,
  LingGitResult,
  LingWorkspaceToolRequest,
  LingWorkspaceTools,
  LingAuthorizationInteraction,
  LingAuthorizationStatus,
  LingAttachmentContent,
  LingCommandResult,
  LingCustomProviderDraft,
  LingDiscoveredModel,
  LingLocalePreference,
  LingModelSelection,
  LingPluginEntry,
  LingPendingMessage,
  LingPromptAttachment,
  LingProviderTestTarget,
  LingQuestionAnswer,
  LingReadResult,
  LingRuntimeAdapter,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingSkill,
  LingSlashCommand,
  LingTaskAgentPreset,
  LingTaskGoal,
  LingTaskMode,
  LingTaskPermission,
  LingTaskSchedule,
  LingTaskTerminal,
  LingTimelineItem,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
} from './contract.js'

const EMPTY_TASKS: LingRuntimeSnapshot['tasks'] = []
const EMPTY_WORKSPACES: LingRuntimeSnapshot['workspaces'] = []
const EMPTY_INTERACTIONS: LingRuntimeSnapshot['pendingInteractions'] = []

function applyRuntimeEvent(
  snapshot: LingRuntimeSnapshot | undefined,
  event: LingRuntimeEvent,
): LingRuntimeSnapshot | undefined {
  if (!snapshot) return snapshot

  switch (event.type) {
    case 'snapshot.replaced':
      return event.snapshot
    case 'connection.changed':
      return { ...snapshot, connection: event.connection }
    case 'task.upsert': {
      const index = snapshot.tasks.findIndex(task => task.taskId === event.task.taskId)
      const tasks = [...snapshot.tasks]
      if (index === -1) tasks.unshift(event.task)
      else tasks[index] = event.task
      return { ...snapshot, tasks }
    }
    case 'task.removed':
      return { ...snapshot, tasks: snapshot.tasks.filter(task => task.taskId !== event.taskId) }
    case 'timeline.append':
      return snapshot
  }
}

function appendTimelineItem(
  current: readonly LingTimelineItem[],
  item: LingTimelineItem,
): readonly LingTimelineItem[] {
  return current.some(candidate => candidate.itemId === item.itemId)
    ? current
    : [...current, item]
}

function requestId() {
  return `renderer-${String(Date.now())}-${Math.random().toString(16).slice(2)}`
}

export interface SubmitOptions {
  readonly requestId?: string
  readonly recordedAttachments?: { readonly seq: number; readonly attachmentIds: readonly string[] }
  readonly model?: LingModelSelection
  readonly agentPreset?: string
  readonly maxGoalRounds?: number
  readonly mode?: 'queue' | 'steer'
  readonly attachments?: readonly LingPromptAttachment[]
  readonly workspaceId?: string
  readonly serverId?: string
  readonly operationsServerId?: string
  readonly permissionPreset?: string
}

export function useLingRuntime(runtime: LingRuntimeAdapter, initialTaskId?: string) {
  const [snapshot, setSnapshot] = useState<LingRuntimeSnapshot>()
  const [selectedTaskId, setSelectedTaskId] = useState<string | undefined>(initialTaskId)
  const [timeline, setTimeline] = useState<readonly LingTimelineItem[]>([])
  const [pendingMessageState, setPendingMessageState] = useState<{ taskId: string; items: readonly LingPendingMessage[] }>()
  const [taskModel, setTaskModel] = useState<LingModelSelection>()
  const selectedTaskIdRef = useRef(selectedTaskId)
  selectedTaskIdRef.current = selectedTaskId

  useEffect(() => {
    let active = true
    void runtime.getSnapshot().then(nextSnapshot => {
      if (active) setSnapshot(nextSnapshot)
    })
    return () => {
      active = false
    }
  }, [runtime])

  useEffect(() => runtime.subscribe(event => {
    setSnapshot(current => applyRuntimeEvent(current, event))
    if (event.type === 'timeline.append' && event.item.taskId === selectedTaskIdRef.current) {
      setTimeline(current => appendTimelineItem(current, event.item))
    }
    if (event.type === 'task.removed' && event.taskId === selectedTaskIdRef.current) {
      setSelectedTaskId(undefined)
      setTimeline([])
    }
  }), [runtime])

  const tasks = snapshot?.tasks ?? EMPTY_TASKS
  const workspaces = snapshot?.workspaces ?? EMPTY_WORKSPACES
  const pendingInteractions = snapshot?.pendingInteractions ?? EMPTY_INTERACTIONS
  const connection = snapshot?.connection ?? {
    phase: 'connecting' as const,
    message: '正在连接…',
  }
  const selectedTask = useMemo(
    () => tasks.find(task => task.taskId === selectedTaskId),
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    if (selectedTaskId && snapshot && !selectedTask) {
      setSelectedTaskId(undefined)
      setTimeline([])
    }
  }, [selectedTask, selectedTaskId, snapshot])

  const backgroundJobs = selectedTaskId === undefined ? [] : (snapshot?.backgroundJobs[selectedTaskId] ?? [])
  const subagents = selectedTaskId === undefined ? undefined : snapshot?.subagents[selectedTaskId]
  const supportsSubagents = runtime.setTaskSubagentsOpen !== undefined

  useEffect(() => {
    const setOpen = runtime.setTaskSubagentsOpen
    if (selectedTaskId === undefined || setOpen === undefined) return
    setOpen(selectedTaskId, true)
    return () => { setOpen(selectedTaskId, false) }
  }, [runtime, selectedTaskId])

  const refreshSubagents = useCallback(async () => {
    if (selectedTaskId === undefined) return
    await runtime.refreshTaskSubagents?.(selectedTaskId)
  }, [runtime, selectedTaskId])

  useEffect(() => {
    if (!selectedTaskId) {
      setTimeline([])
      return
    }

    let active = true
    const unsubscribe = runtime.subscribeTaskTimeline(selectedTaskId, items => {
      if (active) setTimeline(items)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runtime, selectedTaskId])

  const supportsTaskModel = runtime.subscribeTaskModel !== undefined
  const pendingMessages = pendingMessageState && pendingMessageState.taskId === selectedTaskId ? pendingMessageState.items : []
  useEffect(() => {
    if (!selectedTaskId || !runtime.subscribeTaskPendingMessages) return
    let active = true
    const unsubscribe = runtime.subscribeTaskPendingMessages(selectedTaskId, items => {
      if (active) setPendingMessageState({ taskId: selectedTaskId, items })
    })
    return () => { active = false; unsubscribe() }
  }, [runtime, selectedTaskId])
  const updateQueuedMessage = useCallback(async (itemId: string, action: 'steer' | 'remove'): Promise<LingCommandResult> => {
    if (!selectedTaskId) return { accepted: false, requestId: requestId(), reason: 'invalid-command', message: '请先选择会话。', retryable: false }
    return runtime.dispatch({ type: 'task.update-queue', requestId: requestId(), taskId: selectedTaskId, itemId, action })
  }, [runtime, selectedTaskId])
  const supportsDirectoryPick = runtime.pickDirectory !== undefined
  const supportsExtensions = runtime.getTaskSkills !== undefined && runtime.listPlugins !== undefined
  const supportsWorkspaceFiles = runtime.listWorkspaceDirectory !== undefined && runtime.readWorkspaceDocument !== undefined
  const supportsTerminals = runtime.getTaskTerminals !== undefined
  const supportsSchedules = runtime.getTaskSchedules !== undefined

  useEffect(() => {
    const subscribeTaskModel = runtime.subscribeTaskModel
    if (!selectedTaskId || subscribeTaskModel === undefined) {
      setTaskModel(undefined)
      return
    }

    let active = true
    setTaskModel(undefined)
    const unsubscribe = subscribeTaskModel(selectedTaskId, model => {
      if (active) setTaskModel(model)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [runtime, selectedTaskId])

  const startNewTask = useCallback(() => {
    setSelectedTaskId(undefined)
    setTimeline([])
    setTaskModel(undefined)
  }, [])

  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId)
  }, [])

  const selectCreatedTask = useCallback(async (result: LingCommandResult) => {
    if (!result.accepted || result.output === undefined) return result
    try {
      const nextSnapshot = await runtime.getSnapshot()
      setSnapshot(nextSnapshot)
      setSelectedTaskId(result.output.taskId)
    } catch {}
    return result
  }, [runtime])

  const submit = useCallback(async (text: string, options: SubmitOptions = {}): Promise<LingCommandResult> => {
    const result = await (selectedTask
      ? runtime.dispatch({
        type: 'task.send-message',
        requestId: options.requestId ?? requestId(),
        ...(options.recordedAttachments ? { recordedAttachments: options.recordedAttachments } : {}),
        taskId: selectedTask.taskId,
        text,
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {}),
      })
      : runtime.dispatch({
        type: 'task.create',
        ...(options.model ? { model: options.model } : {}),
        ...(options.agentPreset ? { agentPreset: options.agentPreset } : {}),
        requestId: options.requestId ?? requestId(),
        prompt: text,
        ...(options.maxGoalRounds === undefined ? {} : { maxGoalRounds: options.maxGoalRounds }),
        ...(options.workspaceId ? { workspaceId: options.workspaceId } : {}),
        ...(options.serverId ? { serverId: options.serverId } : {}),
        ...(options.operationsServerId ? { operationsServerId: options.operationsServerId } : {}),
        ...(options.attachments ? { attachments: options.attachments } : {}),
        ...(options.permissionPreset ? { permissionPreset: options.permissionPreset } : {}),
      }))
    return await selectCreatedTask(result)
  }, [runtime, selectCreatedTask, selectedTask])

  const reconnect = useCallback(async (): Promise<LingCommandResult> => runtime.dispatch({
    type: 'runtime.reconnect',
    requestId: requestId(),
  }), [runtime])

  const forkTask = useCallback(async (taskId: string, atSeq?: number): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({
      type: 'task.fork',
      requestId: requestId(),
      taskId,
      ...(atSeq === undefined ? {} : { atSeq }),
      increaseTitle: true,
    })
    return await selectCreatedTask(result)
  }, [runtime, selectCreatedTask])

  const cancelTask = useCallback((taskId: string): Promise<LingCommandResult> => runtime.dispatch({
    type: 'task.cancel', requestId: requestId(), taskId,
  }), [runtime])

  const renameTask = useCallback(async (taskId: string, title: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'task.rename', requestId: requestId(), taskId, title })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const setTaskArchived = useCallback(async (taskId: string, archived: boolean): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({
      type: archived ? 'task.archive' : 'task.unarchive',
      requestId: requestId(),
      taskId,
    })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const deleteTask = useCallback(async (taskId: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'task.delete', requestId: requestId(), taskId })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const loadOlder = useCallback((taskId: string): Promise<LingCommandResult> => runtime.dispatch({
    type: 'task.load-older', requestId: requestId(), taskId,
  }), [runtime])

  const runCommand = useCallback(async (taskId: string, line: string, maxGoalRounds?: number, attemptId?: string): Promise<LingCommandResult> => {
    return await runtime.dispatch({ type: 'task.run-command', requestId: attemptId ?? requestId(), taskId, line, ...(maxGoalRounds === undefined ? {} : { maxGoalRounds }) })
  }, [runtime])

  const createWorkspace = useCallback(async (path: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'workspace.create', requestId: requestId(), path })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const renameWorkspace = useCallback(async (workspaceId: string, title: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'workspace.rename', requestId: requestId(), workspaceId, title })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const deleteWorkspace = useCallback(async (workspaceId: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'workspace.delete', requestId: requestId(), workspaceId })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const answerApproval = useCallback(async (interactionId: string, decision: 'allowed-once' | 'rejected'): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'interaction.answer-approval', requestId: requestId(), interactionId, decision })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const answerQuestion = useCallback(async (interactionId: string, answers: readonly LingQuestionAnswer[]): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'interaction.answer-question', requestId: requestId(), interactionId, answers })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const cancelInteraction = useCallback(async (interactionId: string): Promise<LingCommandResult> => {
    const result = await runtime.dispatch({ type: 'interaction.cancel', requestId: requestId(), interactionId })
    if (result.accepted) setSnapshot(await runtime.getSnapshot())
    return result
  }, [runtime])

  const searchTasks = useCallback((query: string, signal?: AbortSignal) => {
    return runtime.searchTasks(query, signal)
  }, [runtime])

  const pickDirectory = useCallback((): Promise<LingReadResult<string | undefined>> => {
    const pick = runtime.pickDirectory
    if (pick === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '目录选择暂时不可用。',
        retryable: false,
      })
    }
    return pick()
  }, [runtime])

  const getTaskChanges = useCallback((taskId: string, signal?: AbortSignal) => {
    return runtime.getTaskChanges(taskId, signal)
  }, [runtime])

  const getTaskFileDiff = useCallback((taskId: string, seq: number, index: number, signal?: AbortSignal) => {
    return runtime.getTaskFileDiff(taskId, seq, index, signal)
  }, [runtime])

  const listWorkspaceDirectory = useCallback((
    taskId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingWorkspaceDirectory>> => {
    const read = runtime.listWorkspaceDirectory
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供工作区文件浏览。',
        retryable: false,
      })
    }
    return read(taskId, path, signal)
  }, [runtime])

  const workspaceGit = useCallback((workspaceId: string, request: LingGitRequest): Promise<LingReadResult<LingGitResult>> => {
    return runtime.workspaceGit?.(workspaceId, request) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: 'Git 操作需要桌面应用。', retryable: false })
  }, [runtime])
  const getWorkspaceBranch = useCallback((workspaceId: string): Promise<string | null> => {
    return runtime.getWorkspaceBranch?.(workspaceId) ?? Promise.resolve(null)
  }, [runtime])
  const workspaceTools = useCallback((workspaceId: string, request: LingWorkspaceToolRequest): Promise<LingReadResult<LingWorkspaceTools>> => {
    return runtime.workspaceTools?.(workspaceId, request) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '工作区操作暂不可用。', retryable: false })
  }, [runtime])

  const readWorkspaceDocument = useCallback((
    taskId: string,
    path: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<LingWorkspaceDocument>> => {
    const read = runtime.readWorkspaceDocument
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供文件预览。',
        retryable: false,
      })
    }
    return read(taskId, path, signal)
  }, [runtime])

  const saveWorkspaceDocument = useCallback((taskId: string, path: string, text: string, version: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly version: string }>> => {
    return runtime.saveWorkspaceDocument?.(taskId, path, text, version, signal) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '当前运行时未提供本地文件保存。', retryable: false })
  }, [runtime])
  const listDraftWorkspaceDirectory = useCallback((workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>> => {
    return runtime.listDraftWorkspaceDirectory?.(workspaceId, path, signal) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '当前运行时未提供工作区浏览。', retryable: false })
  }, [runtime])
  const readDraftWorkspaceDocument = useCallback((workspaceId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>> => {
    return runtime.readDraftWorkspaceDocument?.(workspaceId, path, signal) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '当前运行时未提供工作区文件读取。', retryable: false })
  }, [runtime])
  const saveDraftWorkspaceDocument = useCallback((workspaceId: string, path: string, text: string, version: string, signal?: AbortSignal): Promise<LingReadResult<{ readonly version: string }>> => {
    return runtime.saveDraftWorkspaceDocument?.(workspaceId, path, text, version, signal) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '当前运行时未提供工作区文件保存。', retryable: false })
  }, [runtime])

  const loadTaskAttachment = useCallback((
    taskId: string,
    attachmentId: string,
  ): Promise<LingReadResult<LingAttachmentContent>> => {
    const read = runtime.getTaskAttachment
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供附件读取。',
        retryable: false,
      })
    }
    return read(taskId, attachmentId)
  }, [runtime])

  const getTaskCommands = useCallback((taskId: string): Promise<LingReadResult<readonly LingSlashCommand[]>> => {
    if (!runtime.getTaskCommands) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供指令列表，可直接输入指令并按 Enter 执行。',
        retryable: false,
      })
    }
    return runtime.getTaskCommands(taskId)
  }, [runtime])

  const getTaskPermissions = useCallback((taskId: string): Promise<LingReadResult<LingTaskPermission>> => {
    const read = runtime.getTaskPermissions
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供权限预设。',
        retryable: false,
      })
    }
    return read(taskId)
  }, [runtime])

  const getPermissionCatalog = useCallback(() => runtime.getPermissionCatalog?.() ?? Promise.resolve({
    ok: false as const,
    reason: 'runtime-unavailable' as const,
    message: '当前运行时未提供权限预设。',
    retryable: false as const,
  }), [runtime])

  const getTaskMode = useCallback((taskId: string): Promise<LingReadResult<LingTaskMode>> => {
    const read = runtime.getTaskMode
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供计划与目标模式。',
        retryable: false,
      })
    }
    return read(taskId)
  }, [runtime])

  const getWorkspaceSkills = useCallback((workspaceId: string | undefined, signal: AbortSignal, agentPreset?: string): Promise<LingReadResult<readonly LingSkill[]>> => {
    return runtime.getWorkspaceSkills?.(workspaceId, signal, agentPreset) ?? Promise.resolve({ ok: false, reason: 'runtime-unavailable', message: '工作区技能目录暂时不可用。', retryable: false })
  }, [runtime])

  const getTaskSkills = useCallback((
    taskId: string,
    signal?: AbortSignal,
  ): Promise<LingReadResult<readonly LingSkill[]>> => {
    const read = runtime.getTaskSkills
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供技能目录。',
        retryable: false,
      })
    }
    return read(taskId, signal)
  }, [runtime])

  const getTaskAgentPresets = useCallback((
    taskId?: string,
  ): Promise<LingReadResult<LingTaskAgentPreset>> => {
    const read = runtime.getTaskAgentPresets
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供 Agent 预设。',
        retryable: false,
      })
    }
    return read(taskId)
  }, [runtime])

  const listPlugins = useCallback((): Promise<LingReadResult<readonly LingPluginEntry[]>> => {
    const read = runtime.listPlugins
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供插件清单。',
        retryable: false,
      })
    }
    return read()
  }, [runtime])

  const getTaskTerminals = useCallback((
    taskId: string,
  ): Promise<LingReadResult<readonly LingTaskTerminal[]>> => {
    const read = runtime.getTaskTerminals
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供终端列表。',
        retryable: false,
      })
    }
    return read(taskId)
  }, [runtime])

  const getTaskSchedules = useCallback((
    taskId: string,
  ): Promise<LingReadResult<readonly LingTaskSchedule[] | undefined>> => {
    const read = runtime.getTaskSchedules
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供定时提醒。',
        retryable: false,
      })
    }
    return read(taskId)
  }, [runtime])

  const createTaskTerminal = useCallback((
    taskId: string,
  ): Promise<LingReadResult<LingTaskTerminal>> => {
    const create = runtime.createTaskTerminal
    if (create === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供终端。',
        retryable: false,
      })
    }
    return create(taskId)
  }, [runtime])

  const selectAgentPreset = useCallback(async (
    taskId: string,
    agentPreset: string,
  ): Promise<LingCommandResult> => runtime.dispatch({
    type: 'task.select-agent-preset',
    requestId: requestId(),
    taskId,
    agentPreset,
  }), [runtime])

  const promptSubagent = useCallback((
    subagentSessionId: string,
    text: string,
  ): Promise<LingReadResult<void>> => {
    const prompt = runtime.promptTaskSubagent
    if (selectedTaskId === undefined || prompt === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供子任务操作。',
        retryable: false,
      })
    }
    return prompt(selectedTaskId, subagentSessionId, text)
  }, [runtime, selectedTaskId])

  const interruptSubagent = useCallback((
    subagentSessionId: string,
  ): Promise<LingReadResult<void>> => {
    const interrupt = runtime.interruptTaskSubagent
    if (selectedTaskId === undefined || interrupt === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供子任务操作。',
        retryable: false,
      })
    }
    return interrupt(selectedTaskId, subagentSessionId)
  }, [runtime, selectedTaskId])

  const getLocalePreference = useCallback((): Promise<LingReadResult<LingLocalePreference>> => {
    const read = runtime.getLocalePreference
    if (read === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供语言设置。',
        retryable: false,
      })
    }
    return read()
  }, [runtime])

  const setLocalePreference = useCallback((
    preference: 'zh' | 'en' | undefined,
  ): Promise<LingReadResult<void>> => {
    const write = runtime.setLocalePreference
    if (write === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供语言设置。',
        retryable: false,
      })
    }
    return write(preference)
  }, [runtime])

  const runGoalAction = useCallback(async (
    taskId: string,
    action: 'pause' | 'resume' | 'complete' | 'clear',
    goal: LingTaskGoal,
  ): Promise<LingCommandResult> => {
    return await runtime.dispatch({
      type: 'task.goal-action',
      requestId: requestId(),
      taskId,
      action,
      goalId: goal.goalId,
      revision: goal.revision,
    })
  }, [runtime])

  const getModelSettings = useCallback((signal?: AbortSignal) => {
    return runtime.getModelSettings(signal)
  }, [runtime])

  const selectDefaultModel = useCallback((selection: LingModelSelection): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'model.select-default',
      requestId: requestId(),
      selection,
    })
  }, [runtime])

  const selectTaskModel = useCallback((taskId: string, selection: LingModelSelection): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'model.select-task',
      requestId: requestId(),
      taskId,
      selection,
    })
  }, [runtime])

  const storeProviderApiKey = useCallback((providerId: string, apiKey: string): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'provider.store-api-key',
      requestId: requestId(),
      providerId,
      apiKey,
    })
  }, [runtime])

  const createCustomProvider = useCallback((provider: LingCustomProviderDraft): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'provider.create-custom',
      requestId: requestId(),
      provider,
    })
  }, [runtime])

  const updateCustomProvider = useCallback((provider: LingCustomProviderDraft): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'provider.update-custom',
      requestId: requestId(),
      provider,
    })
  }, [runtime])

  const removeProvider = useCallback((providerId: string): Promise<LingCommandResult> => {
    return runtime.dispatch({
      type: 'provider.delete',
      requestId: requestId(),
      providerId,
    })
  }, [runtime])

  const testProvider = useCallback((target: LingProviderTestTarget): Promise<LingReadResult<readonly LingDiscoveredModel[]>> => {
    const test = runtime.testProvider
    if (test === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '提供商连接测试暂时不可用。',
        retryable: false,
      })
    }
    return test(target)
  }, [runtime])

  const authorizeProvider = useCallback((
    providerId: string,
    interaction: LingAuthorizationInteraction,
    signal: AbortSignal,
  ): Promise<LingReadResult<LingAuthorizationStatus>> => {
    const authorize = runtime.authorizeProvider
    if (authorize === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供账号登录。',
        retryable: false,
      })
    }
    return authorize(providerId, interaction, signal)
  }, [runtime])

  const signOutProvider = useCallback((providerId: string): Promise<LingReadResult<void>> => {
    const signOut = runtime.signOutProvider
    if (signOut === undefined) {
      return Promise.resolve({
        ok: false,
        reason: 'runtime-unavailable',
        message: '当前运行时未提供账号退出。',
        retryable: false,
      })
    }
    return signOut(providerId)
  }, [runtime])

  return {
    pendingMessages,
    updateQueuedMessage,
    answerApproval,
    answerQuestion,
    authorizeProvider,
    backgroundJobs,
    cancelInteraction,
    cancelTask,
    connection,
    createCustomProvider,
    createTaskTerminal,
    createWorkspace,
    deleteWorkspace,
    forkTask,
    getModelSettings,
    getLocalePreference,
    getTaskAgentPresets,
    getTaskChanges,
    getTaskCommands,
    getTaskMode,
    getTaskPermissions,
    getPermissionCatalog,
    getTaskFileDiff,
    getTaskSchedules,
    getTaskSkills,
    getWorkspaceSkills,
    getTaskTerminals,
    interruptSubagent,
    listPlugins,
    listWorkspaceDirectory,
    getWorkspaceBranch,
    workspaceGit,
    workspaceTools,
    loadOlder,
    loadTaskAttachment,
    pendingInteractions,
    pickDirectory,
    promptSubagent,
    readWorkspaceDocument,
    saveWorkspaceDocument,
    listDraftWorkspaceDirectory,
    readDraftWorkspaceDocument,
    saveDraftWorkspaceDocument,
    refreshSubagents,
    reconnect,
    removeProvider,
    renameTask,
    renameWorkspace,
    runCommand,
    runGoalAction,
    searchTasks,
    selectAgentPreset,
    selectCreatedTask,
    selectedTask,
    selectDefaultModel,
    selectTask,
    selectTaskModel,
    setLocalePreference,
    setTaskArchived,
    deleteTask,
    signOutProvider,
    startNewTask,
    storeProviderApiKey,
    subagents,
    submit,
    supportsDirectoryPick,
    supportsExtensions,
    supportsSchedules,
    supportsSubagents,
    supportsTaskModel,
    supportsTerminals,
    supportsWorkspaceFiles,
    taskModel,
    tasks,
    testProvider,
    timeline,
    updateCustomProvider,
    workspaces,
  }
}
