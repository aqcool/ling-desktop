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
  LingGitRequest,
  LingGitResult,
  LingWorkspaceToolRequest,
  LingWorkspaceTools,
  LingAgentPreset,
  LingExtensionSettingsService,
  LingPluginManager,
  LingAuthorizationInteraction,
  LingAuthorizationStatus,
  LingAttachmentContent,
  LingBackgroundJob,
  LingCommandRejectionReason,
  LingCommandResult,
  LingContextBreakdown,
  LingContextPressure,
  LingCustomProviderDraft,
  LingDiscoveredModel,
  LingFileDiff,
  LingLocalePreference,
  LingModelSelection,
  LingModelSettings,
  LingPendingInteraction,
  LingPermissionOption,
  LingPluginEntry,
  LingPromptAttachment,
  LingProviderTestTarget,
  LingReadResult,
  LingRuntimeAdapter,
  LingServerService,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingSkill,
  LingSlashCommand,
  LingSubagent,
  LingSubagentCatalog,
  LingTaskAgentPreset,
  LingTaskGoal,
  LingTaskMode,
  LingTaskSchedule,
  LingTaskStatus,
  LingTaskChanges,
  LingTaskSearchPage,
  LingTaskSearchMatch,
  LingTaskSummary,
  LingTaskTerminal,
  LingTerminalService,
  LingTokenUsage,
  LingTimelineItem,
  LingWorkspaceDirectory,
  LingWorkspaceDocument,
  LingWorkspaceSummary,
} from './contract.js'
import { readyServerHome } from './server-preflight.js'

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
  readonly messageActions?: { prepareAttachments(taskId: string, sourceSeq: number, attachmentIds: readonly string[]): Promise<LingReadResult<Parameters<SessionBinding['session']['prompt']>[0]>> }
  readonly servers?: LingServerService
  /** The upstream client create helper currently drops agentPreset; use the wire API. */
  readonly createSession?: (options: { workspaceId?: string; agentPreset: string }) => ReturnType<ISessions['create']>
  readonly workspaceTools?: { request(path: string, request: LingWorkspaceToolRequest): Promise<LingReadResult<LingWorkspaceTools>> }
  readonly workspaceGit?: { branch(path: string): Promise<string | null>; request?(path: string, request: LingGitRequest): Promise<LingReadResult<LingGitResult>> }
  readonly sessions: Pick<ISessions,
    'create' | 'fork' | 'list' | 'refresh' | 'refreshSubagents' | 'retain' | 'search' | 'setSubagentCatalogOpen' | 'using'>
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
  readonly files?: {
    list(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDirectory>>
    readDocument(taskId: string, path: string, signal?: AbortSignal): Promise<LingReadResult<LingWorkspaceDocument>>
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
  readonly models?: {
    getSnapshot(signal?: AbortSignal): Promise<LingReadResult<LingModelSettings>>
    selectDefault(selection: LingModelSelection): Promise<LingReadResult<void>>
    storeApiKey(providerId: string, apiKey: string): Promise<LingReadResult<void>>
    createCustomProvider(provider: LingCustomProviderDraft): Promise<LingReadResult<void>>
    updateCustomProvider(provider: LingCustomProviderDraft): Promise<LingReadResult<void>>
    deleteProvider(providerId: string): Promise<LingReadResult<void>>
    testProvider(target: LingProviderTestTarget, signal?: AbortSignal): Promise<LingReadResult<readonly LingDiscoveredModel[]>>
    subscribe(listener: () => void): () => void
  }
  readonly authorization?: {
    authorize(
      providerId: string,
      interaction: LingAuthorizationInteraction,
      signal: AbortSignal,
    ): Promise<LingReadResult<LingAuthorizationStatus>>
    signOut(providerId: string): Promise<LingReadResult<void>>
  }
  readonly taskModels?: {
    canSelect(taskId: string): boolean
    select(taskId: string, selection: LingModelSelection): Promise<LingReadResult<void>>
    watch(binding: SessionBinding): {
      getSnapshot(): LingModelSelection | undefined
      subscribe(listener: () => void): () => void
    }
  }
  readonly commands?: {
    list(taskId: string): Promise<LingReadResult<readonly LingSlashCommand[]>>
  }
  readonly permissions?: {
    catalog(): Promise<LingReadResult<readonly LingPermissionOption[]>>
    current(binding: SessionBinding): string | undefined
  }
  readonly mode?: {
    createGoal?(taskId: string, objective: string, maxGoalRounds: number): Promise<LingReadResult<void>>
    plan(binding: SessionBinding): { active: boolean; pending: boolean } | undefined
    goal(taskId: string): Promise<LingReadResult<LingTaskGoal | undefined>>
    goalAction(
      taskId: string,
      action: 'pause' | 'resume' | 'complete' | 'clear',
      goalId: string,
      revision: number,
    ): Promise<LingReadResult<void>>
  }
  readonly extensions?: {
    readonly manager?: LingPluginManager
    readonly settings?: LingExtensionSettingsService
    workspaceSkills?(workspaceId: string | undefined, signal?: AbortSignal, agentPreset?: string): Promise<LingReadResult<readonly LingSkill[]>>
    skills(taskId: string, signal?: AbortSignal): Promise<LingReadResult<readonly LingSkill[]>>
    presets(): Promise<LingReadResult<readonly LingAgentPreset[]>>
    currentPreset(binding: SessionBinding): string | undefined
    selectPreset(taskId: string, presetId: string): Promise<LingReadResult<void>>
    plugins(): Promise<LingReadResult<readonly LingPluginEntry[]>>
  }
  readonly terminals?: {
    readonly service?: LingTerminalService
    list(taskId: string): Promise<LingReadResult<readonly LingTaskTerminal[]>>
    create(taskId: string): Promise<LingReadResult<LingTaskTerminal>>
  }
  readonly subagents?: {
    prompt(parentTaskId: string, subagentSessionId: string, text: string): Promise<LingReadResult<void>>
    interrupt(parentTaskId: string, subagentSessionId: string): Promise<LingReadResult<void>>
  }
  readonly locale?: {
    get(): Promise<LingReadResult<LingLocalePreference>>
    set(preference: 'zh' | 'en' | undefined): Promise<LingReadResult<void>>
  }
  readonly schedules?: {
    list(binding: SessionBinding): readonly LingTaskSchedule[] | undefined
  }
  readonly connectionState?: {
    getSnapshot(): 'connected' | 'disconnected' | 'connecting' | undefined
    subscribe(listener: () => void): () => void
  }
  readonly directoryPicker?: {
    pick(): Promise<LingReadResult<string | undefined>>
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

function terminalStatusFromTimeline(items: readonly LingTimelineItem[]): LingTaskStatus | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (!item) continue
    if (item.streaming || item.status === 'running') return undefined
    if (item.kind === 'user-message' || item.status === undefined) continue
    if (item.status === 'failed') return 'failed'
    if (item.status === 'interrupted') return 'cancelled'
    return 'completed'
  }
  return undefined
}

function tokenUsageProjection(value: unknown): LingTokenUsage | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const usage = value as Record<string, unknown>
  const fields = ['uncachedInputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens'] as const
  if (!fields.every(field => Number.isSafeInteger(usage[field]) && Number(usage[field]) >= 0)) return undefined
  return {
    uncachedInputTokens: Number(usage.uncachedInputTokens),
    cacheReadTokens: Number(usage.cacheReadTokens),
    cacheWriteTokens: Number(usage.cacheWriteTokens),
    outputTokens: Number(usage.outputTokens),
  }
}

function contextPressureProjection(value: unknown): LingContextPressure | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const pressure = value as Record<string, unknown>
  for (const key of ['pressureTokens', 'projectedTokens', 'contextWindow'] as const) {
    if (pressure[key] !== undefined && (!Number.isSafeInteger(pressure[key]) || Number(pressure[key]) < (key === 'contextWindow' ? 1 : 0))) return undefined
  }
  const result: LingContextPressure = {
    ...(pressure.pressureTokens === undefined ? {} : { pressureTokens: Number(pressure.pressureTokens) }),
    ...(pressure.projectedTokens === undefined ? {} : { projectedTokens: Number(pressure.projectedTokens) }),
    ...(pressure.contextWindow === undefined ? {} : { contextWindow: Number(pressure.contextWindow) }),
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function contextBreakdownProjection(value: unknown): LingContextBreakdown | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const breakdown = value as Record<string, unknown>
  if (!(['systemTokens', 'toolsTokens', 'messageTokens'] as const).every(key => Number.isSafeInteger(breakdown[key]) && Number(breakdown[key]) >= 0)) return undefined
  return {
    systemTokens: Number(breakdown.systemTokens),
    toolsTokens: Number(breakdown.toolsTokens),
    messageTokens: Number(breakdown.messageTokens),
  }
}

function taskStatus(
  summary: SessionListState['byId'][string],
  waitingForInput: boolean,
  observed: LingTaskStatus | undefined,
): LingTaskStatus {
  if (waitingForInput) return 'waiting-for-input'
  if (summary.running) return 'running'
  if (summary.blank) return 'queued'
  return observed ?? 'completed'
}

function taskProjection(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
  interactions: readonly LingPendingInteraction[],
  terminalStatuses: ReadonlyMap<string, LingTaskStatus>,
  historyStates: ReadonlyMap<string, boolean>,
): readonly LingTaskSummary[] {
  const workspaceByTask = new Map<string, string>()
  for (const workspace of workspaces.items) {
    for (const taskId of workspace.sessionIds) workspaceByTask.set(taskId, workspace.workspaceId)
  }

  return sessions.ids.flatMap(taskId => {
    const summary = sessions.byId[taskId]
    if (!summary || summary.blank || summary.origin === 'subagent') return []
    const workspaceId = workspaceByTask.get(taskId)
    const tokenUsage = tokenUsageProjection((summary.projectionValues as Record<string, unknown> | undefined)?.tokenUsage)
    const contextPressure = contextPressureProjection((summary.projectionValues as Record<string, unknown> | undefined)?.contextPressure)
    const contextBreakdown = contextBreakdownProjection((summary.projectionValues as Record<string, unknown> | undefined)?.contextBreakdown)
    return [{
      taskId,
      title: summary.title?.trim() || '新任务',
      status: taskStatus(
        summary,
        interactions.some(interaction => interaction.taskId === taskId),
        terminalStatuses.get(taskId),
      ),
      archived: workspaces.archivedSessionIds.includes(taskId),
      updatedAt: new Date(summary.updatedAt).toISOString(),
      ...(workspaceId ? { workspaceId } : {}),
      ...(historyStates.get(taskId) ? { hasOlder: true } : {}),
      ...(tokenUsage === undefined ? {} : { tokenUsage }),
      ...(contextPressure === undefined ? {} : { contextPressure }),
      ...(contextBreakdown === undefined ? {} : { contextBreakdown }),
    }]
  })
}

function connectionProjection(
  sessions: SessionListState,
  workspaces: WorkspaceSnapshot,
  transport: 'connected' | 'disconnected' | 'connecting' | undefined,
): LingRuntimeSnapshot['connection'] {
  if (transport === 'disconnected') return { phase: 'failed', message: '与宿主的连接已断开。' }
  if (transport === 'connecting') return { phase: 'connecting', message: '正在重连…' }
  if (workspaces.state === 'error') return { phase: 'failed', message: '无法读取工作区。' }
  if (sessions.phase === 'ready' && workspaces.phase === 'ready') return { phase: 'ready' }
  return { phase: 'connecting', message: '正在连接…' }
}

function backgroundJobsProjection(
  jobsBySession: SessionListState['jobsBySession'],
): Record<string, readonly LingBackgroundJob[]> {
  const result: Record<string, readonly LingBackgroundJob[]> = {}
  for (const [taskId, jobs] of Object.entries(jobsBySession)) {
    result[taskId] = jobs.map(job => ({
      jobId: job.id,
      kind: job.kind,
      label: job.label,
      status: job.status,
      ...(job.detail === undefined ? {} : { detail: job.detail }),
      startedAt: job.startedAt,
      ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
    }))
  }
  return result
}

function subagentsProjection(
  catalogs: SessionListState['subagentsByParent'],
): Record<string, LingSubagentCatalog> {
  const result: Record<string, LingSubagentCatalog> = {}
  for (const [taskId, catalog] of Object.entries(catalogs)) {
    const subagents: LingSubagent[] = []
    const unreadable: string[] = []
    for (const entry of catalog.entries) {
      if (entry.kind === 'child') {
        subagents.push({
          sessionId: entry.id,
          title: entry.label ?? entry.id,
          activity: entry.activity,
          mode: entry.mode,
          hasChildren: entry.hasChildren,
        })
      } else {
        unreadable.push(entry.id)
      }
    }
    result[taskId] = {
      state: catalog.state,
      subagents,
      unreadable,
      ...(catalog.error === null ? {} : { message: catalog.error?.message ?? '子任务读取失败。' }),
    }
  }
  return result
}

function snapshotProjection(
  facades: DshRuntimeFacades,
  terminalStatuses: ReadonlyMap<string, LingTaskStatus>,
  historyStates: ReadonlyMap<string, boolean>,
): LingRuntimeSnapshot {
  const sessions = facades.sessions.list.getSnapshot()
  const workspaces = facades.workspaces.list.getSnapshot()
  const pendingInteractions = facades.interactions.list.getSnapshot()
  return {
    backgroundJobs: backgroundJobsProjection(sessions.jobsBySession),
    connection: connectionProjection(sessions, workspaces, facades.connectionState?.getSnapshot()),
    subagents: subagentsProjection(sessions.subagentsByParent),
    tasks: taskProjection(sessions, workspaces, pendingInteractions, terminalStatuses, historyStates),
    workspaces: workspaceProjection(workspaces),
    pendingInteractions,
  }
}

function rejectionReason(code: string): LingCommandRejectionReason {
  if (/permission|denied|forbidden/i.test(code)) return 'permission-denied'
  if (/conflict/i.test(code)) return 'settings-conflict'
  if (/not-found|missing/i.test(code)) return 'task-not-found'
  if (/invalid|validation/i.test(code)) return 'invalid-command'
  return 'runtime-unavailable'
}

function isTransientFailure(error: DshRemoteFailure): boolean {
  return /transport|connection|timeout|unavailable|network|fetch|offline/i.test(`${error.code} ${error.message ?? ''}`)
}

function rejected(requestId: string, error: DshRemoteFailure, transientMessage = '操作未能完成。'): LingCommandResult {
  const transient = isTransientFailure(error)
  return {
    accepted: false,
    requestId,
    reason: rejectionReason(error.code),
    message: transient ? transientMessage : (error.message?.trim() || '操作未能完成。'),
    retryable: transient,
  }
}

function readRejected<Value>(error: DshRemoteFailure): LingReadResult<Value> {
  const transient = isTransientFailure(error)
  return {
    ok: false,
    reason: rejectionReason(error.code),
    message: (transient ? undefined : error.message?.trim()) || '读取未能完成。',
    retryable: transient,
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

function modelCommandResult(requestId: string, result: LingReadResult<void>): LingCommandResult {
  return result.ok
    ? { accepted: true, requestId }
    : {
        accepted: false,
        requestId,
        reason: result.reason,
        message: result.message,
        retryable: result.retryable,
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

/** One logical send owns one upstream RPC id, including transport retries. */
function createPromptSender(facades: DshRuntimeFacades) {
  type Prepared = { content: Parameters<SessionBinding['session']['prompt']>[0]; submission: ReturnType<SessionBinding['session']['beginSubmission']> }
  const attempts = new Map<string, { prepared?: Prepared; preparing?: Promise<Prepared>; inFlight?: Promise<LingCommandResult>; accepted?: LingCommandResult }>()
  return async (requestId: string, taskId: string, text: string, mode: 'queue' | 'steer' = 'queue',
    attachments: readonly LingPromptAttachment[] = [], recorded?: { readonly seq: number; readonly attachmentIds: readonly string[] },
    validate?: (binding: SessionBinding) => LingCommandResult | undefined): Promise<LingCommandResult> => {
    const key = `${taskId}:${requestId}`
    let attempt = attempts.get(key)
    if (attempt?.accepted) return attempt.accepted
    if (attempt?.inFlight) return await attempt.inFlight
    if (!attempt) {
      // Bound completed receipts; unresolved attempts must retain their RPC identity.
      if (attempts.size >= 64) {
        const settled = [...attempts].find(([, value]) => value.accepted && !value.inFlight)
        if (settled) attempts.delete(settled[0])
      }
      attempt = {}; attempts.set(key, attempt)
    }
    const state = attempt
    const execute = () => withSession(facades, taskId, async binding => {
      const { session } = binding
      if (!state.prepared) {
        const invalid = validate?.(binding)
        if (invalid) return invalid
        try {
          state.preparing ??= (async () => {
            const prepared = await facades.attachments.prepare(taskId, attachments)
            const original = recorded?.attachmentIds.length
              ? await facades.messageActions?.prepareAttachments(taskId, recorded.seq, recorded.attachmentIds) : undefined
            if (recorded?.attachmentIds.length && !original) throw new Error('当前运行时不支持读取原附件。')
            if (original && !original.ok) throw new Error(original.message)
            const content = [...(text ? [{ type: 'text' as const, text }] : []), ...(original?.ok ? original.value : []), ...prepared.content]
            const submission = session.beginSubmission({ mode, text, attachments: prepared.pending })
            return { content, submission }
          })()
          state.prepared = await state.preparing
          const changed = validate?.(binding)
          if (changed) { state.prepared.submission.abandon(); state.prepared = undefined; state.preparing = undefined; return changed }
        } catch (error) {
          state.preparing = undefined
          return { accepted: false, requestId, reason: 'runtime-unavailable', message: error instanceof Error ? error.message : '附件上传失败。', retryable: true } as LingCommandResult
        }
      }
      const { content, submission } = state.prepared
      try {
        const result = await session.prompt(content, mode, undefined, submission.requestId)
        if (result.ok) {
          state.accepted = { accepted: true, requestId }
          state.prepared = undefined; state.preparing = undefined
          return state.accepted
        }
        submission.abandon()
        return rejected(requestId, result.error, '无法发送消息。')
      } catch {
        submission.abandon()
        return { accepted: false, requestId, reason: 'runtime-unavailable', message: '无法发送消息。', retryable: true } as LingCommandResult
      }
    })
    state.inFlight = execute().finally(() => { state.inFlight = undefined })
    return await state.inFlight
  }
}

export function goalObjective(line: string): string | undefined {
  const objective = /^\/goal\s+([\s\S]+)$/u.exec(line.trim())?.[1]?.trim()
  if (!objective || (/^(?:clear|pause|resume)$/u.test(objective) || /^edit(?:\s|$)/u.test(objective))) return undefined
  return objective
}

export function createDshRuntimeAdapter(facades: DshRuntimeFacades): LingRuntimeAdapter {
  const sendPrompt = createPromptSender(facades)
  const createdTasks = new Map<string, string>()
  const listeners = new Set<(event: LingRuntimeEvent) => void>()
  const terminalStatuses = new Map<string, LingTaskStatus>()
  const historyStates = new Map<string, boolean>()
  const timelineReaders = new Map<string, number>()
  const subagentReaders = new Map<string, number>()
  const directoryPicker = facades.directoryPicker
  let disposeSources: (() => void) | undefined

  const publishSnapshot = () => {
    const event: LingRuntimeEvent = {
      type: 'snapshot.replaced',
      snapshot: snapshotProjection(facades, terminalStatuses, historyStates),
    }
    for (const listener of [...listeners]) listener(event)
  }

  const observeTimeline = (taskId: string, items: readonly LingTimelineItem[]) => {
    const status = terminalStatusFromTimeline(items)
    if (status === undefined) return
    const previous = terminalStatuses.get(taskId)
    if (status === 'completed') {
      if (previous === undefined) return
      terminalStatuses.delete(taskId)
    } else {
      if (previous === status) return
      terminalStatuses.set(taskId, status)
    }
    publishSnapshot()
  }

  return {
    supportsGoalLimit: facades.mode?.createGoal !== undefined,
    async workspaceTools(workspaceId, request) {
      const workspace = facades.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace || !facades.workspaceTools) return unavailableRead('工作区操作暂不可用。')
      try { return await facades.workspaceTools.request(workspace.path, request) }
      catch { return unavailableRead('工作区操作失败。') }
    },
    async workspaceGit(workspaceId, request) {
      const workspace = facades.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace || !facades.workspaceGit?.request) return unavailableRead('Git 操作需要桌面应用。')
      try { return await facades.workspaceGit.request(workspace.path, request) }
      catch { return unavailableRead('Git 操作失败。') }
    },
    async getWorkspaceBranch(workspaceId) {
      const workspace = facades.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      if (!workspace || !facades.workspaceGit) return null
      try { return await facades.workspaceGit.branch(workspace.path) }
      catch { return null }
    },
    async getSnapshot() {
      return snapshotProjection(facades, terminalStatuses, historyStates)
    },
    async getModelSettings(signal = new AbortController().signal) {
      if (facades.models === undefined) return unavailableRead('模型设置暂时不可用。')
      try {
        return await facades.models.getSnapshot(signal)
      } catch {
        return unavailableRead('无法读取模型设置。')
      }
    },
    async testProvider(target, signal = new AbortController().signal) {
      if (facades.models === undefined) return unavailableRead('模型设置暂时不可用。')
      try {
        return await facades.models.testProvider(target, signal)
      } catch {
        return unavailableRead('无法测试该提供商。')
      }
    },
    ...(facades.authorization === undefined ? {} : {
      async authorizeProvider(providerId, interaction, signal) {
        try {
          return await facades.authorization!.authorize(providerId, interaction, signal)
        } catch {
          return unavailableRead<LingAuthorizationStatus>('无法启动提供商登录。')
        }
      },
      async signOutProvider(providerId) {
        try {
          return await facades.authorization!.signOut(providerId)
        } catch {
          return unavailableRead<void>('无法退出当前登录。')
        }
      },
    }),
    async getTaskTimeline(taskId) {
      const items = await withSession(facades, taskId, binding => {
        return facades.conversation.timeline(binding).getSnapshot()
      })
      observeTimeline(taskId, items)
      return items
    },
    async getTaskCommands(taskId) {
      const commands = facades.commands
      if (commands === undefined) return unavailableRead('指令目录暂时不可用。')
      return await commands.list(taskId)
    },
    async getPermissionCatalog() {
      return facades.permissions?.catalog() ?? unavailableRead('权限预设暂时不可用。')
    },
    async getTaskPermissions(taskId) {
      const permissions = facades.permissions
      if (permissions === undefined) return unavailableRead('权限预设暂时不可用。')
      const catalog = await permissions.catalog()
      if (!catalog.ok) return catalog
      try {
        const currentValue = await withSession(facades, taskId, binding => permissions.current(binding))
        return {
          ok: true,
          value: {
            options: catalog.value,
            ...(currentValue === undefined ? {} : { currentValue }),
          },
        }
      } catch {
        return unavailableRead('无法读取权限状态。')
      }
    },
    async getTaskMode(taskId) {
      const mode = facades.mode
      if (mode === undefined) return unavailableRead<LingTaskMode>('任务模式暂时不可用。')
      try {
        const plan = await withSession(facades, taskId, binding => mode.plan(binding))
        const goal = await mode.goal(taskId)
        if (!goal.ok) return goal
        return {
          ok: true,
          value: {
            ...(plan === undefined ? {} : { planActive: plan.active, planPending: plan.pending }),
            ...(goal.value === undefined ? {} : { goal: goal.value }),
          },
        }
      } catch {
        return unavailableRead('无法读取任务模式状态。')
      }
    },
    async getWorkspaceSkills(workspaceId, signal, agentPreset) {
      return await facades.extensions?.workspaceSkills?.(workspaceId, signal, agentPreset) ?? unavailableRead<readonly LingSkill[]>('工作区技能目录暂时不可用。')
    },
    async getTaskSkills(taskId, signal = new AbortController().signal) {
      const extensions = facades.extensions
      if (extensions === undefined) return unavailableRead<readonly LingSkill[]>('技能目录暂时不可用。')
      return await extensions.skills(taskId, signal)
    },
    async promptTaskSubagent(parentTaskId, subagentSessionId, text) {
      const subagents = facades.subagents
      if (subagents === undefined) return unavailableRead<void>('子任务操作暂时不可用。')
      try {
        return await subagents.prompt(parentTaskId, subagentSessionId, text)
      } catch {
        return unavailableRead<void>('追加指令暂时无法发送。')
      }
    },
    async interruptTaskSubagent(parentTaskId, subagentSessionId) {
      const subagents = facades.subagents
      if (subagents === undefined) return unavailableRead<void>('子任务操作暂时不可用。')
      try {
        return await subagents.interrupt(parentTaskId, subagentSessionId)
      } catch {
        return unavailableRead<void>('中断子任务暂时不可用。')
      }
    },
    async getLocalePreference() {
      const locale = facades.locale
      if (locale === undefined) return unavailableRead<LingLocalePreference>('语言设置暂时不可用。')
      try {
        return await locale.get()
      } catch {
        return unavailableRead<LingLocalePreference>('无法读取语言设置。')
      }
    },
    async setLocalePreference(preference) {
      const locale = facades.locale
      if (locale === undefined) return unavailableRead<void>('语言设置暂时不可用。')
      try {
        return await locale.set(preference)
      } catch {
        return unavailableRead<void>('无法保存语言设置。')
      }
    },
    extensionSettings: facades.extensions?.settings,
    pluginManager: facades.extensions?.manager,
    serverManager: facades.servers,
    async getTaskAgentPresets(taskId) {
      const extensions = facades.extensions
      if (extensions === undefined) return unavailableRead<LingTaskAgentPreset>('Agent 预设暂时不可用。')
      const settings = await extensions.settings?.presets()
      const modeSelectionEnabled = settings?.ok ? settings.value.modeSelectionEnabled : undefined
      const presets = settings?.ok ? { ok: true as const, value: settings.value.presets } : await extensions.presets()
      if (!presets.ok) return presets
      if (taskId === undefined) {
        const currentValue = presets.value.find(preset => preset.isDefault)?.id
        return { ok: true, value: { modeSelectionEnabled, options: presets.value, ...(currentValue === undefined ? {} : { currentValue }) } }
      }
      try {
        const currentValue = await withSession(facades, taskId, binding => extensions.currentPreset(binding))
        return {
          ok: true,
          value: {
            modeSelectionEnabled,
            options: presets.value,
            ...(currentValue === undefined ? {} : { currentValue }),
          },
        }
      } catch {
        return unavailableRead('无法读取 Agent 预设状态。')
      }
    },
    async listPlugins() {
      const extensions = facades.extensions
      if (extensions === undefined) return unavailableRead<readonly LingPluginEntry[]>('插件清单暂时不可用。')
      return await extensions.plugins()
    },
    terminalService: facades.terminals?.service,
    async getTaskTerminals(taskId) {
      const terminals = facades.terminals
      if (terminals === undefined) return unavailableRead<readonly LingTaskTerminal[]>('终端列表暂时不可用。')
      return await terminals.list(taskId)
    },
    async createTaskTerminal(taskId) {
      const terminals = facades.terminals
      if (terminals === undefined) return unavailableRead<LingTaskTerminal>('终端列表暂时不可用。')
      return await terminals.create(taskId)
    },
    async getTaskSchedules(taskId) {
      const schedules = facades.schedules
      if (schedules === undefined) return unavailableRead<readonly LingTaskSchedule[] | undefined>('定时提醒暂时不可用。')
      try {
        const value = await withSession(facades, taskId, binding => schedules.list(binding))
        return { ok: true, value }
      } catch {
        return unavailableRead('无法读取定时提醒。')
      }
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
        const snapshot = snapshotProjection(facades, terminalStatuses, historyStates)
        const tasks = new Map(snapshot.tasks.map(task => [task.taskId, task]))
        const indexedMatches: LingTaskSearchMatch[] = result.value.items.map((item: { sessionId: string; snippet: string }) => {
          const task = tasks.get(String(item.sessionId))
          return {
            taskId: String(item.sessionId),
            snippet: item.snippet,
            ...(task === undefined ? {} : {
              title: task.title,
              ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
            }),
          }
        })
        const indexedById = new Map(indexedMatches.map(item => [item.taskId, item]))
        const needle = value.toLocaleLowerCase()
        const workspaceById = new Map(snapshot.workspaces.map(workspace => [workspace.workspaceId, workspace]))
        const localMatches: LingTaskSearchMatch[] = snapshot.tasks
          .filter(task => {
            if (task.archived) return false
            const workspace = workspaceById.get(task.workspaceId ?? '')
            return task.title.toLocaleLowerCase().includes(needle)
              || (workspace !== undefined && (
                workspace.label.toLocaleLowerCase().includes(needle)
                || (workspace.locationLabel ?? '').toLocaleLowerCase().includes(needle)
              ))
          })
          .map(task => indexedById.get(task.taskId) ?? ({
            taskId: task.taskId,
            title: task.title,
            snippet: task.preview || task.title,
            ...(task.workspaceId === undefined ? {} : { workspaceId: task.workspaceId }),
          }))
        const localMatchIds = new Set(localMatches.map(item => item.taskId))
        return {
          ok: true,
          value: {
            hasMore: result.value.hasMore,
            items: [...localMatches, ...indexedMatches.filter(item => !localMatchIds.has(item.taskId))],
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
    async listWorkspaceDirectory(taskId, path, signal = new AbortController().signal) {
      const files = facades.files
      if (files === undefined) return unavailableRead<LingWorkspaceDirectory>('工作区文件暂时不可用。')
      return await files.list(taskId, path, signal)
    },
    async readWorkspaceDocument(taskId, path, signal = new AbortController().signal) {
      const files = facades.files
      if (files === undefined) return unavailableRead<LingWorkspaceDocument>('工作区文件暂时不可用。')
      return await files.readDocument(taskId, path, signal)
    },
    async getTaskAttachment(taskId, attachmentId) {
      try {
        const result = await withSession(facades, taskId, ({ session }) => {
          const identifier = attachmentId as Parameters<SessionBinding['session']['readAttachment']>[0]
          return session.readAttachment(identifier)
        })
        if (!result.ok) return readRejected<LingAttachmentContent>(result.error)
        return {
          ok: true,
          value: {
            mediaType: result.value.attachment.mediaType,
            data: result.value.data,
          },
        }
      } catch {
        return unavailableRead('无法读取附件内容。')
      }
    },
    async getTaskModel(taskId) {
      const taskModels = facades.taskModels
      if (taskModels === undefined) return unavailableRead<LingModelSelection | undefined>('任务模型暂时不可用。')
      try {
        return await withSession(facades, taskId, binding => ({
          ok: true as const,
          value: taskModels.watch(binding).getSnapshot(),
        }))
      } catch {
        return unavailableRead('无法读取任务模型。')
      }
    },
    setTaskSubagentsOpen(taskId, open) {
      const count = subagentReaders.get(taskId) ?? 0
      const next = Math.max(0, count + (open ? 1 : -1))
      if (next) subagentReaders.set(taskId, next); else subagentReaders.delete(taskId)
      if ((count > 0) !== (next > 0)) facades.sessions.setSubagentCatalogOpen(taskId, next > 0)
    },
    async refreshTaskSubagents(taskId) {
      try {
        await facades.sessions.refreshSubagents(taskId)
        return { ok: true, value: undefined }
      } catch {
        return unavailableRead<void>('无法读取子任务。')
      }
    },
    ...(directoryPicker === undefined ? {} : {
      async pickDirectory(): Promise<LingReadResult<string | undefined>> {
        try {
          return await directoryPicker.pick()
        } catch {
          return unavailableRead('无法打开目录选择。')
        }
      },
    }),
    async dispatch(command: LingRuntimeCommand) {
      try {
        if (command.type === 'runtime.reconnect') {
          if (facades.reconnect) await facades.reconnect()
          else await facades.sessions.refresh()
          return { accepted: true, requestId: command.requestId }
        }
        if (command.type === 'model.select-default') {
          if (facades.models === undefined) return modelCommandResult(command.requestId, unavailableRead('模型设置暂时不可用。'))
          return modelCommandResult(command.requestId, await facades.models.selectDefault(command.selection))
        }
        if (command.type === 'model.select-task') {
          const taskModels = facades.taskModels
          if (taskModels === undefined) return modelCommandResult(command.requestId, unavailableRead('任务模型暂时不可用。'))
          if (!taskModels.canSelect(command.taskId)) {
            return modelCommandResult(command.requestId, {
              ok: false,
              reason: 'invalid-command',
              message: '该任务不支持单独选择模型。',
              retryable: false,
            })
          }
          return modelCommandResult(
            command.requestId,
            await withSession(facades, command.taskId, () => taskModels.select(command.taskId, command.selection)),
          )
        }
        if (command.type === 'provider.store-api-key') {
          if (facades.models === undefined) return modelCommandResult(command.requestId, unavailableRead('模型设置暂时不可用。'))
          return modelCommandResult(command.requestId, await facades.models.storeApiKey(command.providerId, command.apiKey))
        }
        if (command.type === 'provider.create-custom') {
          if (facades.models === undefined) return modelCommandResult(command.requestId, unavailableRead('模型设置暂时不可用。'))
          return modelCommandResult(command.requestId, await facades.models.createCustomProvider(command.provider))
        }
        if (command.type === 'provider.update-custom') {
          if (facades.models === undefined) return modelCommandResult(command.requestId, unavailableRead('模型设置暂时不可用。'))
          return modelCommandResult(command.requestId, await facades.models.updateCustomProvider(command.provider))
        }
        if (command.type === 'provider.delete') {
          if (facades.models === undefined) return modelCommandResult(command.requestId, unavailableRead('模型设置暂时不可用。'))
          return modelCommandResult(command.requestId, await facades.models.deleteProvider(command.providerId))
        }
        if ((command.type === 'task.create' || command.type === 'task.run-command') && command.maxGoalRounds !== undefined && (!Number.isSafeInteger(command.maxGoalRounds) || command.maxGoalRounds < 1 || command.maxGoalRounds > 256)) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '目标轮次应为 1 至 256 的整数。', retryable: false }
        if (command.type === 'task.create') {
          if (!command.prompt.trim() && !command.attachments?.length) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '请输入消息。', retryable: false }
          if (command.serverId && command.workspaceId) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '远端任务不能同时选择本地工作区。', retryable: false }
          if (command.serverId && command.operationsServerId) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '远端开发和本地运维目标不能同时选择。', retryable: false }
          if (command.model && !facades.taskModels) return modelCommandResult(command.requestId, unavailableRead<void>('当前运行时不支持任务模型选择。'))
          if (command.maxGoalRounds !== undefined && goalObjective(command.prompt) && !facades.mode?.createGoal) return modelCommandResult(command.requestId, unavailableRead<void>('当前运行时不支持目标轮次配置。'))
          const modeCommand = /^\/(goal|plan)(?:\s|$)/u.test(command.prompt)
          if (modeCommand && command.attachments?.length) return {
            accepted: false, requestId: command.requestId, reason: 'invalid-command',
            message: '目标与计划指令暂不支持附件，请移除附件后重试。', retryable: false,
          }
          if (command.permissionPreset) {
            const catalog = await facades.permissions?.catalog()
            if (!catalog?.ok || !catalog.value.some(option => option.value === command.permissionPreset)) {
              return {
                accepted: false,
                requestId: command.requestId,
                reason: 'invalid-command',
                message: '所选权限预设已不可用。',
                retryable: false,
              }
            }
          }
          if (command.agentPreset && !facades.createSession) return modelCommandResult(command.requestId, unavailableRead<void>('当前运行时不支持选择智能体。'))
          let remoteHome: string | undefined
          const chosenServerId = command.serverId ?? command.operationsServerId
          if (chosenServerId) {
            if (!facades.servers) return modelCommandResult(command.requestId, unavailableRead<void>('服务器服务暂时不可用。'))
            try {
              remoteHome = await readyServerHome(chosenServerId)
            } catch (error) {
              return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable',
                message: error instanceof Error ? error.message : '服务器无法连接。', retryable: true }
            }
          }
          const workspace = command.workspaceId ? { workspaceId: command.workspaceId } : {}
          const taskId = createdTasks.get(command.requestId) ?? (command.agentPreset
            ? await facades.createSession!({ ...workspace, agentPreset: command.agentPreset })
            : await facades.sessions.create(workspace))
          if (createdTasks.size >= 64 && !createdTasks.has(command.requestId)) createdTasks.delete(createdTasks.keys().next().value!)
          createdTasks.set(command.requestId, String(taskId))
          if (command.serverId && remoteHome) {
            const bound = await facades.servers!.bindTask(String(taskId), command.serverId, remoteHome)
            if (!bound.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: bound.message, retryable: true }
          }
          if (command.operationsServerId && remoteHome) {
            const bound = await facades.servers!.attachOperations(String(taskId), command.operationsServerId, remoteHome)
            if (!bound.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: bound.message, retryable: true }
          }
          if (command.model) {
            const selection = await withSession(facades, String(taskId), () => facades.taskModels!.select(String(taskId), command.model!))
            if (!selection.ok) return modelCommandResult(command.requestId, selection)
          }
          if (command.permissionPreset) {
            const permissionResult = await withSession(facades, String(taskId), ({ session }) => session.command(`/permission ${command.permissionPreset}`))
            if (!permissionResult.ok) return rejected(command.requestId, permissionResult.error)
            if (!permissionResult.value.matched) return {
              accepted: false,
              requestId: command.requestId,
              reason: 'invalid-command',
              message: '无法为新任务应用权限预设。',
              retryable: false,
            }
          }
          if (modeCommand && command.maxGoalRounds !== undefined && goalObjective(command.prompt)) {
            const result = facades.mode?.createGoal
              ? await facades.mode.createGoal(String(taskId), goalObjective(command.prompt)!, command.maxGoalRounds)
              : unavailableRead<void>('当前运行时不支持目标轮次配置。')
            const outcome = modelCommandResult(command.requestId, result)
            return outcome.accepted ? { ...outcome, output: { taskId: String(taskId) } } : outcome
          }
          if (modeCommand) {
            const result = await withSession(facades, String(taskId), ({ session }) => session.command(command.prompt))
            if (!result.ok) return rejected(command.requestId, result.error)
            return result.value.matched
              ? { accepted: true, requestId: command.requestId, output: { taskId: String(taskId) } }
              : { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '当前运行时不支持此模式。', retryable: false }
          }
          const result = await sendPrompt(
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
          const sourceServer = await facades.servers?.taskBinding(command.taskId)
          if (sourceServer && !sourceServer.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: sourceServer.message, retryable: true }
          const sourceOperations = await facades.servers?.operationsBinding(command.taskId)
          if (sourceOperations && !sourceOperations.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: sourceOperations.message, retryable: true }
          const taskId = await facades.sessions.fork({
            sessionId: command.taskId,
            ...(command.atSeq === undefined ? {} : { atSeq: command.atSeq }),
            ...(command.increaseTitle === undefined ? {} : { increaseTitle: command.increaseTitle }),
          })
          if (sourceServer?.ok && sourceServer.value) {
            const bound = await facades.servers!.bindTask(String(taskId), sourceServer.value.serverId, sourceServer.value.cwd)
            if (!bound.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: bound.message, retryable: true }
          }
          if (sourceOperations?.ok && sourceOperations.value) {
            const bound = await facades.servers!.attachOperations(String(taskId), sourceOperations.value.serverId, sourceOperations.value.cwd)
            if (!bound.ok) return { accepted: false, requestId: command.requestId, reason: 'runtime-unavailable', message: bound.message, retryable: true }
          }
          return {
            accepted: true,
            requestId: command.requestId,
            output: { taskId: String(taskId) },
          }
        }
        if (command.type === 'task.resend-message') {
          if (connectionProjection(facades.sessions.list.getSnapshot(), facades.workspaces.list.getSnapshot(), facades.connectionState?.getSnapshot()).phase !== 'ready') return modelCommandResult(command.requestId, unavailableRead<void>('连接中断，请重新连接后重试。'))
          return await withSession(facades, command.taskId, async binding => {
            const items = facades.conversation.timeline(binding).getSnapshot()
            const original = items.find(item => item.itemId === command.itemId && item.kind === 'user-message')
            if (!original || original.seq === undefined) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '找不到原消息，请重新打开会话。', retryable: false }
            const validate = (current: SessionBinding): LingCommandResult | undefined => {
              if (current.session.getSnapshot().running) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '请等待当前任务结束后再重发。', retryable: false }
              const now = facades.conversation.timeline(current).getSnapshot()
              const failure = now.findLast(item => item.kind === 'system-notice' && item.status === 'failed')
              if ((now.findLast(item => item.kind === 'user-message')?.itemId !== original.itemId || (failure?.turn !== undefined && failure.retrySourceId !== original.itemId))) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '会话已有新消息，请重试最新一轮。', retryable: false }
            }
            return await sendPrompt(command.requestId, command.taskId, original.text, 'queue', [],
              { seq: original.seq, attachmentIds: original.attachments?.map(a => a.attachmentId) ?? [] }, validate)
          })
        }
        if (command.type === 'task.send-message') {
          return await sendPrompt(
            command.requestId,
            command.taskId,
            command.text,
            command.mode,
            command.attachments,
            command.recordedAttachments,
          )
        }
        if (command.type === 'workspace.create') {
          const workspace = await facades.workspaces.create({ path: command.path })
          return { accepted: true, requestId: command.requestId, ...(workspace?.workspaceId ? { output: { workspaceId: String(workspace.workspaceId) } } : {}) }
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
        if (command.type === 'task.goal-action') {
          const mode = facades.mode
          if (mode === undefined) return modelCommandResult(command.requestId, unavailableRead('任务模式暂时不可用。'))
          return modelCommandResult(command.requestId, await mode.goalAction(
            command.taskId,
            command.action,
            command.goalId,
            command.revision,
          ))
        }
        if (command.type === 'task.select-agent-preset') {
          const extensions = facades.extensions
          if (extensions === undefined) {
            return modelCommandResult(command.requestId, unavailableRead('Agent 预设暂时不可用。'))
          }
          return modelCommandResult(command.requestId, await extensions.selectPreset(
            command.taskId,
            command.agentPreset,
          ))
        }
        if (command.type === 'task.run-command' && command.maxGoalRounds !== undefined && goalObjective(command.line)) {
          return modelCommandResult(command.requestId, facades.mode?.createGoal
            ? await facades.mode.createGoal(command.taskId, goalObjective(command.line)!, command.maxGoalRounds)
            : unavailableRead<void>('当前运行时不支持目标轮次配置。'))
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
      } catch (error) {
        console.error('[ling] runtime command failed', command.type, error)
        return {
          accepted: false,
          requestId: command.requestId,
          reason: 'runtime-unavailable',
          message: '无法连接灵创。',
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
        const disposeConnection = facades.connectionState?.subscribe(publishSnapshot)
        disposeSources = () => {
          disposeWorkspaces()
          disposeSessions()
          disposeInteractions()
          disposeConnection?.()
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
    subscribeModelSettings(listener) {
      return facades.models?.subscribe(listener) ?? (() => {})
    },
    subscribeTaskModel(taskId, listener) {
      const taskModels = facades.taskModels
      if (taskModels === undefined) return () => {}
      const abort = new AbortController()
      const reference = facades.sessions.retain(taskId, {
        source: 'lingRenderer',
        signal: abort.signal,
      })
      let disposeFace: (() => void) | undefined
      void reference.ready.then(binding => {
        if (abort.signal.aborted) return
        const source = taskModels.watch(binding)
        const publish = () => { listener(source.getSnapshot()) }
        disposeFace = source.subscribe(publish)
        publish()
      }).catch(() => {})
      return () => {
        abort.abort()
        disposeFace?.()
        reference.release()
      }
    },
    subscribeTaskTimeline(taskId, listener) {
      timelineReaders.set(taskId, (timelineReaders.get(taskId) ?? 0) + 1)
      const abort = new AbortController()
      const reference = facades.sessions.retain(taskId, {
        source: 'lingRenderer',
        signal: abort.signal,
      })
      let disposeEvents: (() => void) | undefined
      let disposeHistory: (() => void) | undefined
      void reference.ready.then(binding => {
        if (abort.signal.aborted) return
        const source = facades.conversation.timeline(binding)
        const syncHistory = () => {
          const hasOlder = binding.session.getSnapshot().hasMore === true
          if (historyStates.get(taskId) === hasOlder) return
          historyStates.set(taskId, hasOlder)
          publishSnapshot()
        }
        const publish = () => {
          const items = source.getSnapshot()
          observeTimeline(taskId, items)
          syncHistory()
          listener(items)
        }
        disposeEvents = source.subscribe(publish)
        disposeHistory = binding.session.subscribe(syncHistory)
        publish()
      }).catch(() => {})
      return () => {
        if (abort.signal.aborted) return
        abort.abort()
        disposeEvents?.()
        disposeHistory?.()
        const remaining = Math.max(0, (timelineReaders.get(taskId) ?? 1) - 1)
        if (remaining) timelineReaders.set(taskId, remaining)
        else { timelineReaders.delete(taskId); historyStates.delete(taskId) }
        reference.release()
      }
    },
  }
}
