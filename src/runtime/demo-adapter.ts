import type {
  LingChangedFile,
  LingCommandResult,
  LingCustomProviderDraft,
  LingFileDiff,
  LingLocalePreference,
  LingModelProvider,
  LingModelSelection,
  LingModelSettings,
  LingPermissionOption,
  LingPendingInteraction,
  LingPromptAttachment,
  LingQuestion,
  LingQuestionAnswer,
  LingReadResult,
  LingRuntimeAdapter,
  LingRuntimeCommand,
  LingRuntimeEvent,
  LingRuntimeSnapshot,
  LingSlashCommand,
  LingSubagent,
  LingTaskChanges,
  LingTaskSearchMatch,
  LingTaskSearchPage,
  LingTaskStatus,
  LingTaskSummary,
  LingTimelineItem,
  LingWorkspaceSummary,
} from './contract.js'

interface DemoTask {
  summary: LingTaskSummary
  timeline: LingTimelineItem[]
  changes: LingTaskChanges[]
  olderRemaining: number
}

const nowIso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString()

const demoCommands: readonly LingSlashCommand[] = [
  { name: 'compact', description: '压缩当前上下文', hint: '[补充说明]' },
  { name: 'plan', description: '进入计划模式并给出方案' },
  { name: 'goal', description: '设定或查看当前目标', hint: '<目标描述>' },
  { name: 'permission', description: '调整本会话的工具权限', hint: '<read-only|ask|auto>' },
  { name: 'model', description: '切换本轮使用的模型', hint: '<模型名>' },
  { name: 'export', description: '导出当前会话记录' },
  { name: 'feedback', description: '提交产品反馈', hint: '<反馈内容>' },
]

const demoPermissionOptions: readonly LingPermissionOption[] = [
  { value: 'read-only', label: '只读', description: '读取文件与信息，修改前需要调整权限。' },
  { value: 'ask', label: '需要确认', description: '修改文件或执行有影响的操作前先询问。' },
  { value: 'auto', label: '自动审批', description: '仅在检测到潜在风险时询问。' },
  { value: 'danger-full-access', label: '完全访问', description: '不再询问，可自由访问你的文件、终端和网络。' },
]

function commandName(line: string): string {
  return line.trim().replace(/^\/+/, '').split(/\s+/u)[0]?.toLowerCase() ?? ''
}

function attachmentNote(attachments: readonly LingPromptAttachment[]): string {
  const names = attachments.map((attachment, index) => attachment.name ?? `附件 ${String(index + 1)}`)
  if (names.length === 0) return ''
  return `已接收附件：${names.join('、')}`
}

const coarseDiffPaths = new Set(['src/runtime/contract.ts'])

function diffFor(file: LingChangedFile, taskId: string): LingFileDiff {
  if (file.binary) return { kind: 'binary', path: file.path, display: file.display }
  if (file.oversized) return { kind: 'oversized', path: file.path, display: file.display }
  const removed = Array.from({ length: file.deleted }, (_, index) => `-// 旧实现 ${String(index + 1)} ${taskId}`)
  const added = Array.from({ length: file.added }, (_, index) => `+export const generated = ${String(index + 1)}`)
  return {
    kind: 'text',
    path: file.path,
    display: file.display,
    before: removed.length > 0,
    after: added.length > 0,
    hunks: [{
      oldStart: removed.length > 0 ? 1 : 0,
      oldLines: removed.length,
      newStart: added.length > 0 ? 1 : 0,
      newLines: added.length,
      lines: [...removed, ...added],
    }],
    coarse: coarseDiffPaths.has(file.path),
  }
}

function seedProvider(providerId: string, displayName: string, models: [string, string][], credential: LingModelProvider['credential'], active: boolean): LingModelProvider {
  return {
    providerId,
    displayName,
    active,
    configurable: true,
    configured: credential === 'configured',
    credential,
    canStoreApiKey: credential !== 'not-required',
    models: models.map(([id, name]) => ({ id, name })),
  }
}

export function createDemoRuntimeAdapter(): LingRuntimeAdapter {
  const workspaces: LingWorkspaceSummary[] = [
    { workspaceId: 'ws-ling', label: 'ling-desktop', locationLabel: '~/Desktop/ling-desktop' },
    { workspaceId: 'ws-web', label: 'web-playground', locationLabel: '~/projects/web-playground' },
  ]

  const tasks = new Map<string, DemoTask>()
  const taskOrder: string[] = []
  const subagentCatalogs = new Map<string, LingSubagent[]>()
  const taskPermissions = new Map<string, string>()
  let localePreference: LingLocalePreference['preference']
  let taskCounter = 0
  let interactionCounter = 0
  let itemCounter = 0

  const interactions: LingPendingInteraction[] = []
  let modelSettings: LingModelSettings = {
    writable: true,
    defaultSelection: { provider: 'deepseek', model: 'deepseek-chat', reasoningEffort: 'medium' },
    providers: [
      seedProvider('deepseek', 'DeepSeek', [['deepseek-chat', 'DeepSeek Chat'], ['deepseek-reasoner', 'DeepSeek Reasoner']], 'configured', true),
      seedProvider('anthropic', 'Anthropic', [['claude-sonnet', 'Claude Sonnet']], 'missing', true),
      seedProvider('openai', 'OpenAI', [['gpt-5', 'GPT-5'], ['gpt-5-mini', 'GPT-5 mini']], 'not-required', false),
      {
        ...seedProvider('gateway', '企业网关', [['gateway-coder', 'Gateway Coder']], 'configured', true),
        configurable: false,
        models: [{ id: 'gateway-coder', name: 'Gateway Coder', description: '统一接入，按工作区计费。' }],
      },
    ],
  }

  const eventListeners = new Set<(event: LingRuntimeEvent) => void>()
  const timelineListeners = new Map<string, Set<(items: readonly LingTimelineItem[]) => void>>()
  const modelListeners = new Set<() => void>()

  const nextTaskId = () => `task-${String(++taskCounter)}`
  const nextItemId = () => `item-${String(++itemCounter)}`

  let demoSeq = 0
  function makeItem(taskId: string, patch: Partial<LingTimelineItem> & Pick<LingTimelineItem, 'kind'>): LingTimelineItem {
    demoSeq += 1
    return {
      itemId: nextItemId(),
      taskId,
      seq: demoSeq,
      text: '',
      createdAt: nowIso(),
      ...patch,
    }
  }

  function pushTimeline(taskId: string, item: LingTimelineItem) {
    const task = tasks.get(taskId)
    if (!task) return
    task.timeline.push(item)
    notifyTimeline(taskId)
  }

  function updateItem(taskId: string, itemId: string, patch: Partial<LingTimelineItem>) {
    const task = tasks.get(taskId)
    if (!task) return
    const index = task.timeline.findIndex(item => item.itemId === itemId)
    const current = index >= 0 ? task.timeline[index] : undefined
    if (current) task.timeline[index] = { ...current, ...patch }
    notifyTimeline(taskId)
  }

  function addTask(summary: LingTaskSummary, timeline: LingTimelineItem[], changes: LingTaskChanges[] = [], olderRemaining = 0) {
    const nextSummary = olderRemaining > 0 ? { ...summary, hasOlder: true } : summary
    tasks.set(summary.taskId, { summary: nextSummary, timeline, changes, olderRemaining })
    taskOrder.unshift(summary.taskId)
  }

  function notifyTimeline(taskId: string) {
    const task = tasks.get(taskId)
    if (!task) return
    const listeners = timelineListeners.get(taskId)
    if (!listeners) return
    for (const listener of [...listeners]) listener([...task.timeline])
  }

  function publish() {
    const event: LingRuntimeEvent = { type: 'snapshot.replaced', snapshot: getSnapshotValue() }
    for (const listener of [...eventListeners]) listener(event)
  }

  function previewOf(timeline: readonly LingTimelineItem[]): string | undefined {
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const text = (timeline[index]?.text ?? '').replace(/[#*`>_[\]]/gu, '').replace(/\s+/gu, ' ').trim()
      if (text) return text.length > 48 ? `${text.slice(0, 48)}…` : text
    }
    return undefined
  }

  function getSnapshotValue(): LingRuntimeSnapshot {
    return {
      connection: { phase: 'ready', message: '本地演示运行环境' },
      workspaces: [...workspaces],
      tasks: taskOrder.filter(id => tasks.has(id)).map(id => {
        const task = tasks.get(id)!
        return { ...task.summary, preview: previewOf(task.timeline) }
      }),
      pendingInteractions: [...interactions],
      backgroundJobs: {},
      subagents: Object.fromEntries([...subagentCatalogs].map(([taskId, list]) => [taskId, {
        state: 'ready' as const,
        subagents: list.map(subagent => ({ ...subagent })),
        unreadable: [],
      }])),
    }
  }

  function setTaskStatus(taskId: string, status: LingTaskStatus) {
    const task = tasks.get(taskId)
    if (!task) return
    task.summary = { ...task.summary, status, updatedAt: nowIso() }
  }

  function removeInteraction(interactionId: string): LingPendingInteraction | undefined {
    const index = interactions.findIndex(interaction => interaction.interactionId === interactionId)
    if (index < 0) return undefined
    const [removed] = interactions.splice(index, 1)
    return removed
  }

  function delay(ms: number, run: () => void) {
    const timer = setTimeout(run, ms)
    return () => clearTimeout(timer)
  }

  const runTokens = new Map<string, number>()

  function nextRunToken(taskId: string): number {
    const token = (runTokens.get(taskId) ?? 0) + 1
    runTokens.set(taskId, token)
    return token
  }

  function isCurrentRun(taskId: string, token: number): boolean {
    return runTokens.get(taskId) === token
  }

  function simulateAssistantTurn(taskId: string, replyMd: string, options: { tool?: string, changes?: LingChangedFile[], approval?: { toolName: string, reason: string }, question?: LingQuestion } = {}) {
    const token = nextRunToken(taskId)
    const after = (ms: number, run: () => void) => {
      delay(ms, () => {
        if (isCurrentRun(taskId, token)) run()
      })
    }
    setTaskStatus(taskId, 'running')
    publish()
    after(350, () => {
      if (options.tool) {
        pushTimeline(taskId, makeItem(taskId, {
          kind: 'tool-activity',
          title: options.tool,
          text: '正在运行工具',
          detail: '$ npm run test\n\nRUN  v4.1.8\n ✓ 24 tests passed',
          status: 'running',
        }))
        const toolItem = tasks.get(taskId)!.timeline.at(-1)!
        after(900, () => {
          updateItem(taskId, toolItem.itemId, { status: 'completed', text: '工具执行完成' })
          if (options.approval) {
            const interactionId = `int-${String(++interactionCounter)}`
            interactions.push({ interactionId, taskId, kind: 'approval', toolName: options.approval.toolName, reason: options.approval.reason })
            setTaskStatus(taskId, 'waiting-for-input')
            publish()
            return
          }
          finishAssistant(taskId, replyMd, options, token)
        })
        return
      }
      if (options.question) {
        const interactionId = `int-${String(++interactionCounter)}`
        interactions.push({ interactionId, taskId, kind: 'question', questions: [options.question] })
        setTaskStatus(taskId, 'waiting-for-input')
        publish()
        return
      }
      finishAssistant(taskId, replyMd, options, token)
    })
  }

  function finishAssistant(taskId: string, replyMd: string, options: { changes?: LingChangedFile[] }, token: number) {
    const itemId = nextItemId()
    pushTimeline(taskId, makeItem(taskId, { itemId, kind: 'assistant-message', text: '', streaming: true }))
    const tokens = replyMd.split(/(\s+)/u)
    let index = 0
    const step = () => {
      if (!isCurrentRun(taskId, token)) return
      index += 1
      updateItem(taskId, itemId, { text: tokens.slice(0, index).join('') })
      if (index < tokens.length) {
        delay(45, step)
        return
      }
      updateItem(taskId, itemId, { streaming: false })
      if (options.changes && options.changes.length > 0) {
        const task = tasks.get(taskId)!
        const seq = task.changes.length + 1
        task.changes = [...task.changes, {
          taskId,
          turn: seq,
          seq,
          files: options.changes,
          total: options.changes.length,
          added: options.changes.reduce((sum, file) => sum + file.added, 0),
          deleted: options.changes.reduce((sum, file) => sum + file.deleted, 0),
        }]
      }
      setTaskStatus(taskId, 'completed')
      publish()
    }
    delay(45, step)
  }

  // Seed an already-completed conversation with tool activity, markdown and changes.
  const seedId = 'task-seed'
  addTask(
    { taskId: seedId, title: '重构运行时适配器', status: 'completed', archived: false, updatedAt: nowIso(-86_400_000), workspaceId: 'ws-ling', tokenUsage: { uncachedInputTokens: 12_200, cacheReadTokens: 6_200, cacheWriteTokens: 800, outputTokens: 3_500 }, contextPressure: { pressureTokens: 2_700, projectedTokens: 3_000, contextWindow: 4_000 } },
    [
      makeItem(seedId, { kind: 'user-message', text: '把会话投影逻辑收敛到 adapter，并补上类型。', createdAt: nowIso(-86_000) }),
      makeItem(seedId, { kind: 'assistant-message', title: '计划', text: '我会分三步处理：\n\n1. 抽取 `snapshotProjection`\n2. 收敛命令分发\n3. 补充回归测试\n\n参考 [DSH Session 文档](https://example.com/session)。', detail: '先确认 adapter 是唯一的 DSH 入口，避免把 Session 事件重复解析。', createdAt: nowIso(-84_000), status: 'completed' }),
      makeItem(seedId, { kind: 'tool-activity', title: '编辑 src/runtime/dsh-adapter.ts', text: '已更新 3 处', detail: '```ts\nfunction snapshotProjection(facades: DshRuntimeFacades): LingRuntimeSnapshot {\n  return {\n    connection: connectionProjection(sessions, workspaces),\n    tasks: taskProjection(sessions, workspaces, interactions),\n  }\n}\n```', status: 'completed', createdAt: nowIso(-80_000) }),
      makeItem(seedId, { kind: 'assistant-message', text: '完成了。运行结果：\n\n```bash\n✓ 22 tests passed\n```\n\n改动集中在投影函数，测试全部通过。\n\n| 文件 | 增删 |\n| :--- | ---: |\n| dsh-adapter.ts | +18 / -4 |\n| Composer.tsx | +7 / -1 |', createdAt: nowIso(-78_000), status: 'completed' }),
    ],
    [{
      taskId: seedId, turn: 1, seq: 1, total: 6, added: 46, deleted: 15,
      files: [
        { path: 'src/runtime/dsh-adapter.ts', display: 'src/runtime/dsh-adapter.ts', added: 30, deleted: 4 },
        { path: 'src/runtime/contract.ts', display: 'src/runtime/contract.ts', added: 4, deleted: 2 },
        { path: 'src/runtime/change-projection.ts', display: 'src/runtime/change-projection.ts', added: 12, deleted: 0 },
        { path: 'src/ui/LegacyChangesPanel.tsx', display: 'src/ui/LegacyChangesPanel.tsx', added: 0, deleted: 9 },
        { path: 'public/logo.png', display: 'public/logo.png', added: 0, deleted: 0, binary: true },
        { path: 'fixtures/session.jsonc', display: 'fixtures/session.jsonc', added: 0, deleted: 0, oversized: true },
      ],
    }],
    2,
  )

  const runningId = 'task-running'
  addTask(
    { taskId: runningId, title: '为 Composer 增加附件', status: 'waiting-for-input', archived: false, updatedAt: nowIso(-120_000), workspaceId: 'ws-ling', tokenUsage: { uncachedInputTokens: 2_400, cacheReadTokens: 1_100, cacheWriteTokens: 0, outputTokens: 840 }, contextPressure: { pressureTokens: 3_150, projectedTokens: 3_280, contextWindow: 4_000 } },
    [
      makeItem(runningId, { kind: 'user-message', text: '支持选择、粘贴和拖拽附件，并在发送前展示缩略图。', createdAt: nowIso(-110_000) }),
      makeItem(runningId, { kind: 'tool-activity', title: '写入 src/ui/Composer.tsx', text: '请求写入文件', detail: '需要写入 Composer.tsx 以渲染附件预览。', status: 'running', createdAt: nowIso(-60_000) }),
    ],
  )
  interactions.push({ interactionId: `int-${String(++interactionCounter)}`, taskId: runningId, kind: 'approval', toolName: 'write_file', callId: 'call-42', reason: '写入 src/ui/Composer.tsx 需要确认。' })

  addTask(
    { taskId: 'task-plan', title: '设计设置中心', status: 'waiting-for-input', archived: false, updatedAt: nowIso(-2_000), workspaceId: 'ws-web' },
    [makeItem('task-plan', { kind: 'user-message', text: '帮我规划设置中心的信息架构。', createdAt: nowIso(-2_000) })],
  )
  interactions.push({
    interactionId: `int-${String(++interactionCounter)}`,
    taskId: 'task-plan',
    kind: 'plan-review',
    questions: [{
      questionId: 'q-scope',
      header: '范围',
      prompt: '设置中心需要包含哪些分组？',
      detail: '将决定导航结构。',
      multiple: true,
      options: [{ label: '模型与提供商' }, { label: '扩展与 Agent' }, { label: '外观与快捷键' }, { label: '关于' }],
    }],
  })

  addTask(
    { taskId: 'task-archived', title: '清理演示脚本', status: 'completed', archived: true, updatedAt: nowIso(-600_000), workspaceId: 'ws-ling' },
    [makeItem('task-archived', { kind: 'user-message', text: '移除无用的脚本。', createdAt: nowIso(-600_000) }), makeItem('task-archived', { kind: 'assistant-message', text: '已删除 3 个脚本。', status: 'completed', createdAt: nowIso(-599_000) })],
  )

  subagentCatalogs.set('task-seed', [
    { sessionId: 'sub-seed-1', title: '梳理改动要点', activity: 'inactive', mode: 'one-shot', hasChildren: false },
  ])
  subagentCatalogs.set('task-running', [
    { sessionId: 'sub-run-1', title: '调研附件交互', activity: 'running', mode: 'continuable', hasChildren: false },
    { sessionId: 'sub-run-2', title: '整理测试清单', activity: 'inactive', mode: 'continuable', hasChildren: false },
  ])

  function searchItems(query: string): readonly LingTaskSearchMatch[] {
    const needle = query.toLocaleLowerCase()
    const workspaceById = new Map(workspaces.map(workspace => [workspace.workspaceId, workspace]))
    const matches: LingTaskSearchMatch[] = []
    for (const taskId of taskOrder) {
      const task = tasks.get(taskId)
      if (!task || task.summary.archived) continue
      const workspace = workspaceById.get(task.summary.workspaceId ?? '')
      const workspaceMatches = workspace !== undefined && (
        workspace.label.toLocaleLowerCase().includes(needle)
        || (workspace.locationLabel ?? '').toLocaleLowerCase().includes(needle)
      )
      const titleMatches = task.summary.title.toLocaleLowerCase().includes(needle)
      const hit = task.timeline.find(item => item.text.toLocaleLowerCase().includes(needle) || (item.title ?? '').toLocaleLowerCase().includes(needle))
      if (workspaceMatches || titleMatches || hit) {
        matches.push({
          taskId,
          title: task.summary.title,
          snippet: hit?.text.slice(0, 120) || hit?.title || previewOf(task.timeline) || task.summary.title,
          ...(task.summary.workspaceId ? { workspaceId: task.summary.workspaceId } : {}),
        })
      }
    }
    return matches
  }

  async function dispatch(command: LingRuntimeCommand): Promise<LingCommandResult> {
    const ok = (): LingCommandResult => ({ accepted: true, requestId: command.requestId })
    const unsupported = (): LingCommandResult => ({
      accepted: false,
      requestId: command.requestId,
      reason: 'invalid-command',
      message: '该操作在演示环境不支持。',
      retryable: false,
    })
    switch (command.type) {
      case 'runtime.reconnect':
        return ok()
      case 'model.select-default': {
        modelSettings = { ...modelSettings, defaultSelection: command.selection }
        for (const listener of [...modelListeners]) listener()
        return ok()
      }
      case 'provider.store-api-key': {
        modelSettings = {
          ...modelSettings,
          providers: modelSettings.providers.map(provider => provider.providerId === command.providerId
            ? { ...provider, credential: 'configured', configured: true }
            : provider),
        }
        for (const listener of [...modelListeners]) listener()
        return ok()
      }
      case 'provider.create-custom': {
        const draft: LingCustomProviderDraft = command.provider
        if (modelSettings.providers.some(provider => provider.providerId === draft.providerId)) {
          return { accepted: false, requestId: command.requestId, reason: 'settings-conflict', message: '该提供商标识已存在。', retryable: false }
        }
        modelSettings = {
          ...modelSettings,
          providers: [...modelSettings.providers, seedProvider(
            draft.providerId,
            draft.displayName ?? draft.providerId,
            draft.models.map(model => [model.id, model.name ?? model.id]),
            draft.apiKey ? 'configured' : 'missing',
            true,
          )],
        }
        for (const listener of [...modelListeners]) listener()
        return { accepted: true, requestId: command.requestId }
      }
      case 'task.create': {
        if (command.permissionPreset && !demoPermissionOptions.some(option => option.value === command.permissionPreset)) {
          return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '所选权限预设不可用。', retryable: false }
        }
        const taskId = nextTaskId()
        taskPermissions.set(taskId, command.permissionPreset ?? 'ask')
        const workspaceId = command.workspaceId ?? workspaces[0]?.workspaceId
        const title = command.prompt.trim().slice(0, 24) || '新任务'
        addTask(
          { taskId, title, status: 'running', archived: false, updatedAt: nowIso(), ...(workspaceId ? { workspaceId } : {}) },
          [makeItem(taskId, { kind: 'user-message', text: command.prompt })],
        )
        const note = attachmentNote(command.attachments ?? [])
        if (note) pushTimeline(taskId, makeItem(taskId, { kind: 'system-notice', text: note }))
        publish()
        simulateAssistantTurn(taskId,
          `我收到需求：\n\n> ${command.prompt.replace(/\n/gu, '\n> ')}\n\n先探索仓库结构，再给出改动方案。你可以展开右侧 **变更** 面板查看每个文件的 diff。`,
          { tool: '检索仓库文件', approval: { toolName: 'run_command', reason: '该命令会修改工作区文件，需要你的批准。' } },
        )
        return { accepted: true, requestId: command.requestId, output: { taskId } }
      }
      case 'task.send-message': {
        const task = tasks.get(command.taskId)
        if (!task) return { accepted: false, requestId: command.requestId, reason: 'task-not-found', message: '任务不存在。', retryable: false }
        pushTimeline(command.taskId, makeItem(command.taskId, { kind: 'user-message', text: command.text }))
        const note = attachmentNote(command.attachments ?? [])
        if (note) pushTimeline(command.taskId, makeItem(command.taskId, { kind: 'system-notice', text: note }))
        simulateAssistantTurn(command.taskId, `已按${command.mode === 'steer' ? '追加' : ''}指令继续处理，并更新结论。`)
        publish()
        return ok()
      }
      case 'task.cancel': {
        const task = tasks.get(command.taskId)
        if (!task) return { accepted: false, requestId: command.requestId, reason: 'task-not-found', message: '任务不存在。', retryable: false }
        nextRunToken(command.taskId)
        task.timeline = task.timeline.map(item => (item.kind === 'tool-activity' && item.status === 'running'
          ? { ...item, status: 'interrupted' as const, text: '已停止' }
          : item))
        for (let index = interactions.length - 1; index >= 0; index -= 1) {
          if (interactions[index]?.taskId === command.taskId) interactions.splice(index, 1)
        }
        setTaskStatus(command.taskId, 'cancelled')
        pushTimeline(command.taskId, makeItem(command.taskId, { kind: 'system-notice', text: '已停止当前运行。', status: 'interrupted' }))
        notifyTimeline(command.taskId)
        publish()
        return ok()
      }
      case 'task.rename': {
        const task = tasks.get(command.taskId)
        if (!task) return { accepted: false, requestId: command.requestId, reason: 'task-not-found', message: '任务不存在。', retryable: false }
        task.summary = { ...task.summary, title: command.title }
        publish()
        return ok()
      }
      case 'task.fork': {
        const task = tasks.get(command.taskId)
        if (!task) return { accepted: false, requestId: command.requestId, reason: 'task-not-found', message: '任务不存在。', retryable: false }
        const anchor = command.atSeq === undefined
          ? -1
          : task.timeline.findIndex(item => item.seq === command.atSeq)
        const forkedTimeline = anchor >= 0 ? task.timeline.slice(0, anchor + 1) : task.timeline
        const taskId = nextTaskId()
        addTask(
          { ...task.summary, taskId, title: `${task.summary.title} · 分叉`, status: 'completed', updatedAt: nowIso(), archived: false },
          forkedTimeline.map(item => ({ ...item, itemId: nextItemId(), taskId })),
          task.changes.map((change, index) => ({ ...change, taskId, seq: index + 1 })),
          task.olderRemaining,
        )
        publish()
        return { accepted: true, requestId: command.requestId, output: { taskId } }
      }
      case 'task.delete': {
        const task = tasks.get(command.taskId)
        if (!task?.summary.archived || task.summary.status === 'running' || task.summary.status === 'waiting-for-input') return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '只能删除已归档且未运行的会话。', retryable: false }
        tasks.delete(command.taskId)
        publish()
        return { accepted: true, requestId: command.requestId }
      }
      case 'task.archive': {
        const task = tasks.get(command.taskId)
        if (task) { task.summary = { ...task.summary, archived: true }; publish() }
        return ok()
      }
      case 'task.unarchive': {
        const task = tasks.get(command.taskId)
        if (task) { task.summary = { ...task.summary, archived: false }; publish() }
        return ok()
      }
      case 'task.load-older': {
        const task = tasks.get(command.taskId)
        if (!task) return { accepted: false, requestId: command.requestId, reason: 'task-not-found', message: '任务不存在。', retryable: false }
        if (task.olderRemaining > 0) {
          const older = [
            makeItem(command.taskId, { kind: 'user-message', text: '（更早的记录）更早的一次提问。', createdAt: nowIso(-920_000) }),
            makeItem(command.taskId, { kind: 'assistant-message', text: '（更早的记录）这是加载出的历史消息。', createdAt: nowIso(-900_000), status: 'completed' }),
          ]
          task.timeline.unshift(...older)
          task.olderRemaining -= 1
          task.summary = { ...task.summary, hasOlder: task.olderRemaining > 0 }
          notifyTimeline(command.taskId)
          publish()
        }
        return ok()
      }
      case 'task.run-command': {
        const task = tasks.get(command.taskId)
        const name = commandName(command.line)
        const matched = demoCommands.find(item => item.name === name)
        if (!matched) {
          return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: `没有名为 /${name || '?'} 的指令。`, retryable: false }
        }
        if (name === 'permission') {
          const value = command.line.trim().split(/\s+/u)[1]
          if (!value || !demoPermissionOptions.some(option => option.value === value)) {
            return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '请选择有效的权限预设。', retryable: false }
          }
          taskPermissions.set(command.taskId, value)
        }
        if (name === 'compact' && task?.summary.contextPressure?.contextWindow) {
          const current = task.summary.contextPressure
          const capacity = current.contextWindow ?? 0
          task.summary = {
            ...task.summary,
            contextPressure: {
              ...current,
              projectedTokens: Math.min(
                current.projectedTokens ?? current.pressureTokens ?? 0,
                Math.round(capacity * 0.3),
              ),
            },
          }
        }
        if (task) pushTimeline(command.taskId, makeItem(command.taskId, { kind: 'system-notice', text: `已执行 /${matched.name}。`, status: 'completed' }))
        publish()
        return ok()
      }
      case 'workspace.create': {
        const path = command.path.trim()
        if (!path) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '请输入目录路径。', retryable: false }
        if (!path.startsWith('/') && !path.startsWith('~')) {
          return { accepted: false, requestId: command.requestId, reason: 'permission-denied', message: '目录路径必须为绝对路径。', retryable: false }
        }
        const workspaceId = `ws-${String(workspaces.length + 1)}`
        workspaces.push({ workspaceId, label: path.split('/').filter(Boolean).at(-1) ?? path, locationLabel: path })
        publish()
        return { accepted: true, requestId: command.requestId }
      }
      case 'workspace.rename': {
        const index = workspaces.findIndex(candidate => candidate.workspaceId === command.workspaceId)
        const workspace = workspaces[index]
        if (!workspace) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '工作区不存在。', retryable: false }
        workspaces[index] = { ...workspace, label: command.title }
        publish()
        return ok()
      }
      case 'workspace.delete': {
        const index = workspaces.findIndex(candidate => candidate.workspaceId === command.workspaceId)
        if (index < 0) return { accepted: false, requestId: command.requestId, reason: 'invalid-command', message: '工作区不存在。', retryable: false }
        workspaces.splice(index, 1)
        for (const taskId of taskOrder) {
          const task = tasks.get(taskId)
          if (task?.summary.workspaceId === command.workspaceId) task.summary = { ...task.summary, workspaceId: undefined }
        }
        publish()
        return ok()
      }
      case 'interaction.answer-approval': {
        const removed = removeInteraction(command.interactionId)
        if (!removed) return { accepted: false, requestId: command.requestId, reason: 'interaction-stale', message: '这项请求已经结束。', retryable: false }
        publish()
        if (removed.kind === 'approval' && command.decision === 'allowed-once') {
          pushTimeline(removed.taskId, makeItem(removed.taskId, { kind: 'system-notice', text: `已批准 ${removed.toolName}。`, status: 'completed' }))
          simulateAssistantTurn(removed.taskId, '获得批准后继续执行，并完成了这一步改动。')
        } else {
          const taskId = removed.taskId
          pushTimeline(taskId, makeItem(taskId, { kind: 'system-notice', text: '已拒绝该工具请求。', status: 'interrupted' }))
          setTaskStatus(taskId, 'cancelled')
          publish()
        }
        return ok()
      }
      case 'interaction.answer-question': {
        const removed = removeInteraction(command.interactionId)
        if (!removed) return { accepted: false, requestId: command.requestId, reason: 'interaction-stale', message: '这项请求已经结束。', retryable: false }
        const answerText = command.answers.map((answer: LingQuestionAnswer) => answer.custom ?? answer.selected.join('、')).filter(Boolean).join('；')
        pushTimeline(removed.taskId, makeItem(removed.taskId, { kind: 'system-notice', text: `你的选择：${answerText || '（未填写）'}`, status: 'completed' }))
        simulateAssistantTurn(removed.taskId, `收到回答：“${answerText || '未填写'}”。我据此更新方案。`)
        publish()
        return ok()
      }
      case 'interaction.cancel': {
        const removed = removeInteraction(command.interactionId)
        if (!removed) return { accepted: false, requestId: command.requestId, reason: 'interaction-stale', message: '这项请求已经结束。', retryable: false }
        pushTimeline(removed.taskId, makeItem(removed.taskId, { kind: 'system-notice', text: '已跳过这次询问。', status: 'interrupted' }))
        setTaskStatus(removed.taskId, 'cancelled')
        publish()
        return ok()
      }
      default:
        return unsupported()
    }
  }

  return {
    kind: 'offline-demo',
    async getSnapshot() {
      return getSnapshotValue()
    },
    async getWorkspaceBranch(workspaceId) {
      return workspaceId === 'ws-ling' ? 'main' : null
    },
    async getModelSettings(): Promise<LingReadResult<LingModelSettings>> {
      return { ok: true, value: { ...modelSettings, providers: modelSettings.providers.map(p => ({ ...p, models: [...p.models] })) } }
    },
    async getTaskTimeline(taskId) {
      return [...(tasks.get(taskId)?.timeline ?? [])]
    },
    async searchTasks(query) {
      const value = query.trim()
      if (!value) return { ok: false, reason: 'invalid-command', message: '请输入搜索内容。', retryable: false }
      const items = searchItems(value)
      return { ok: true, value: { items, hasMore: false } satisfies LingTaskSearchPage }
    },
    async getTaskChanges(taskId) {
      return { ok: true, value: [...(tasks.get(taskId)?.changes ?? [])] }
    },
    async getTaskCommands() {
      return { ok: true, value: demoCommands.map(item => ({ ...item })) }
    },
    async getPermissionCatalog() {
      return { ok: true, value: [...demoPermissionOptions] }
    },
    async getTaskPermissions(taskId) {
      if (!tasks.has(taskId)) return { ok: false, reason: 'task-not-found', message: '任务不存在。', retryable: false }
      return { ok: true, value: { options: [...demoPermissionOptions], currentValue: taskPermissions.get(taskId) ?? 'ask' } }
    },
    async getTaskFileDiff(taskId, seq, index) {
      const change = tasks.get(taskId)?.changes.find(item => item.seq === seq)
      const file = change?.files[index]
      if (!file) return { ok: false, reason: 'task-not-found', message: '这项文件变更已经不可用。', retryable: false }
      return { ok: true, value: diffFor(file, taskId) }
    },
    async promptTaskSubagent(parentTaskId, subagentSessionId, text) {
      const value = text.trim()
      if (!value) return { ok: false, reason: 'invalid-command', message: '请输入要追加的指令。', retryable: false }
      const list = subagentCatalogs.get(parentTaskId)
      const subagent = list?.find(candidate => candidate.sessionId === subagentSessionId)
      if (!list || !subagent) return { ok: false, reason: 'task-not-found', message: '子任务不存在。', retryable: false }
      if (subagent.mode !== 'continuable') {
        return { ok: false, reason: 'invalid-command', message: '该子任务不支持追加指令。', retryable: false }
      }
      list[list.indexOf(subagent)] = { ...subagent, activity: 'running' }
      pushTimeline(parentTaskId, makeItem(parentTaskId, {
        kind: 'system-notice',
        text: `已向子任务「${subagent.title}」追加指令。`,
        status: 'completed',
      }))
      publish()
      return { ok: true, value: undefined }
    },
    async interruptTaskSubagent(parentTaskId, subagentSessionId) {
      const list = subagentCatalogs.get(parentTaskId)
      const subagent = list?.find(candidate => candidate.sessionId === subagentSessionId)
      if (!list || !subagent) return { ok: false, reason: 'task-not-found', message: '子任务不存在。', retryable: false }
      if (subagent.activity !== 'running') {
        return { ok: false, reason: 'invalid-command', message: '该子任务当前没有在运行。', retryable: false }
      }
      list[list.indexOf(subagent)] = { ...subagent, activity: 'inactive' }
      pushTimeline(parentTaskId, makeItem(parentTaskId, {
        kind: 'system-notice',
        text: `已中断子任务「${subagent.title}」。`,
        status: 'interrupted',
      }))
      publish()
      return { ok: true, value: undefined }
    },
    async getLocalePreference(): Promise<LingReadResult<LingLocalePreference>> {
      return { ok: true, value: localePreference === undefined ? {} : { preference: localePreference } }
    },
    async setLocalePreference(preference): Promise<LingReadResult<void>> {
      localePreference = preference
      return { ok: true, value: undefined }
    },
    dispatch,
    subscribe(listener) {
      eventListeners.add(listener)
      return () => { eventListeners.delete(listener) }
    },
    subscribeModelSettings(listener) {
      modelListeners.add(listener)
      return () => { modelListeners.delete(listener) }
    },
    subscribeTaskTimeline(taskId, listener) {
      let set = timelineListeners.get(taskId)
      if (!set) {
        set = new Set()
        timelineListeners.set(taskId, set)
      }
      set.add(listener)
      listener([...(tasks.get(taskId)?.timeline ?? [])])
      return () => {
        set!.delete(listener)
        if (set!.size === 0) timelineListeners.delete(taskId)
      }
    },
  }
}
