import { describe, expect, it, vi } from 'vitest'
import type { LingPendingInteraction, LingRuntimeSnapshot, LingTimelineItem } from '../src/runtime/contract.js'
import { createDshRuntimeAdapter, type DshRuntimeFacades } from '../src/runtime/dsh-adapter.js'

class Source<Value> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: Value) {}

  getSnapshot(): Value {
    return this.value
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  set(value: Value): void {
    this.value = value
    for (const listener of this.listeners) listener()
  }
}

function fixture(goalLimit = false) {
  const createGoal = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const workspaceList = new Source({
    items: [{
      workspaceId: 'workspace-1',
      path: '/work/ling',
      title: 'LING',
      sessionIds: ['session-1'],
      createdAt: '2026-09-21T00:00:00.000Z',
      updatedAt: '2026-09-21T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  })
  const sessionList = new Source<{
    ids: string[]
    byId: Record<string, Record<string, unknown>>
    phase: string
    subagentsByParent: Record<string, unknown>
    jobsBySession: Record<string, unknown>
  }>({
    ids: ['session-1'],
    byId: {
      'session-1': {
        id: 'session-1',
        displayTitle: '实现 Renderer', title: '实现 Renderer',
        running: true,
        retainedBy: {},
        blank: false,
        updatedAt: 1_758_412_800_000,
      },
    },
    phase: 'ready',
    subagentsByParent: {},
    jobsBySession: {},
  })
  const timelineSource = new Source<readonly LingTimelineItem[]>([
    {
      itemId: 'session-1:user:1',
      taskId: 'session-1',
      kind: 'user-message',
      text: '继续实现',
      createdAt: '2025-09-21T00:00:00.000Z',
    },
    {
      itemId: 'session-1:tool:2',
      taskId: 'session-1',
      kind: 'tool-activity',
      title: 'terminal',
      text: '构建通过',
      createdAt: '2025-09-21T00:00:01.000Z',
      status: 'completed',
    },
    {
      itemId: 'session-1:assistant:3',
      taskId: 'session-1',
      kind: 'assistant-message',
      text: '已经完成。',
      createdAt: '2025-09-21T00:00:02.000Z',
      status: 'completed',
    },
  ])
  const eventSource = new Source({
    entries: [],
    hasMore: false,
    revision: 1,
    change: { kind: 'replace', entries: [] },
  })
  const prompt = vi.fn(async () => ({ ok: true, value: { accepted: true } }))
  const cancel = vi.fn(async () => ({ ok: true, value: { accepted: true } }))
  const renameTask = vi.fn(async () => ({ ok: true, value: { title: '新标题', seq: 4 } }))
  const loadOlder = vi.fn(async () => {})
  const runCommand = vi.fn(async () => ({ ok: true, value: { matched: true } }))
  const readAttachment = vi.fn(async () => ({
    ok: true as const,
    value: {
      attachment: { attachmentId: 'sha256:image-1', mediaType: 'image/png' },
      data: new Uint8Array([137, 80, 78, 71]),
    },
  }))
  const beginSubmission = vi.fn(() => ({ requestId: 'submission-1', abandon: vi.fn() }))
  const sessionHistory = { hasMore: false, running: true }
  const sessionListeners = new Set<() => void>()
  const binding = {
    sessionId: 'session-1',
    session: {
      getSnapshot: () => ({ ...sessionHistory }),
      subscribe: (listener: () => void) => {
        sessionListeners.add(listener)
        return () => sessionListeners.delete(listener)
      },
      beginSubmission,
      prompt,
      cancel,
      readAttachment,
      rename: renameTask,
      loadOlder,
      command: runCommand,
    },
    eventSource,
    ctx: {},
  }
  const release = vi.fn()
  const reference = { binding, ready: Promise.resolve(binding), release }
  const retain = vi.fn(() => reference)
  const using = vi.fn(async (_target, _options, operation) => await operation(reference))
  const create = vi.fn(async () => 'session-created')
  const fork = vi.fn(async () => 'session-forked')
  const search = vi.fn(async () => ({
    ok: true as const,
    value: {
      items: [{ sessionId: 'session-1', snippet: '…继续实现 renderer…' }],
      hasMore: false,
    },
  }))
  const refresh = vi.fn(async () => {})
  const refreshSubagents = vi.fn(async () => {})
  const setSubagentCatalogOpen = vi.fn()
  const createWorkspace = vi.fn(async () => ({}))
  const renameWorkspace = vi.fn(async () => ({}))
  const deleteWorkspace = vi.fn(async () => {})
  const archiveSession = vi.fn(async () => {})
  const unarchiveSession = vi.fn(async () => {})
  const interactionSource = new Source<readonly LingPendingInteraction[]>([])
  const respond = vi.fn(async () => true)
  const prepareAttachments = vi.fn(async () => ({ content: [], pending: [] }))
  const listChanges = vi.fn(async () => [{
    taskId: 'session-1',
    turn: 1,
    seq: 8,
    files: [{ path: 'src/app.ts', display: 'src/app.ts', added: 3, deleted: 1 }],
    total: 1,
    added: 3,
    deleted: 1,
  }])
  const readDiff = vi.fn(async () => ({
    kind: 'text' as const,
    path: 'src/app.ts',
    display: 'src/app.ts',
    before: true,
    after: true,
    hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['-old', '+new'] }],
    coarse: false,
  }))
  const listFiles = vi.fn(async () => ({
    ok: true as const,
    value: {
      path: 'src',
      entries: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file' as const, bytes: 24 }],
      truncated: false,
    },
  }))
  const readDocument = vi.fn(async () => ({
    ok: true as const,
    value: {
      path: 'src/app.ts',
      kind: 'code' as const,
      mediaType: 'text/plain',
      text: 'export const value = 1\n',
      lines: 1,
      truncated: false,
      bytes: 24,
    },
  }))
  let transport: 'connected' | 'disconnected' | 'connecting' | undefined
  const transportListeners = new Set<() => void>()
  const listCommands = vi.fn(async () => ({
    ok: true as const,
    value: [{ name: 'compact', description: '压缩当前上下文' }, {
      name: 'permission',
      description: '切换权限预设',
      hint: '<preset>',
    }],
  }))
  const permissionCatalog = vi.fn(async () => ({
    ok: true as const,
    value: [
      { label: '只读', value: 'read-only' },
      { description: '工具自动放行', label: '自动放行', value: 'auto' },
    ],
  }))
  const permissionCurrent = vi.fn(() => 'auto')
  const modePlan = vi.fn((): { active: boolean; pending: boolean } | undefined => ({ active: true, pending: false }))
  const modeGoal = vi.fn(async () => ({
    ok: true as const,
    value: {
      goalId: 'goal-1',
      revision: 3,
      objective: '修复全部门禁',
      phase: 'active' as const,
      roundsStarted: 2,
      maxGoalRounds: 8,
    },
  }))
  const modeGoalAction = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const listSkills = vi.fn(async () => ({
    ok: true as const,
    value: [{ name: 'report', description: '生成报告', path: '/work/ling/skills/report', modelInvocable: true }],
  }))
  const listPresets = vi.fn(async () => ({
    ok: true as const,
    value: [
      { id: 'default', label: '默认', isDefault: true, trust: 'system' as const },
      { id: 'reviewer', label: '评审助手', isDefault: false, trust: 'user' as const },
    ],
  }))
  const currentPreset = vi.fn(() => 'reviewer')
  const selectPreset = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const listPlugins = vi.fn(async () => ({
    ok: true as const,
    value: [{ id: '4', moduleName: '@deepseek-ai/dsh-doc', enabled: true, phase: 'active' }],
  }))
  const listTerminals = vi.fn(async () => ({
    ok: true as const,
    value: [{ terminalId: 'term-1', title: 'shell 1', shell: 'zsh', cwd: '/work/ling', state: 'running' as const }],
  }))
  const createTerminal = vi.fn(async () => ({
    ok: true as const,
    value: { terminalId: 'term-2', title: 'shell 2', shell: 'zsh', cwd: '/work/ling', state: 'running' as const },
  }))
  const listSchedules = vi.fn(() => [
    { scheduleId: 'sch-1', kind: 'at' as const, prompt: '汇报进度', scheduledAt: '2026-09-22T15:00:00.000Z' },
  ])
  const subagentPrompt = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const subagentInterrupt = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const localeGet = vi.fn(async () => ({ ok: true as const, value: { preference: 'zh' as const } }))
  const localeSet = vi.fn(async () => ({ ok: true as const, value: undefined }))
  const facades = {
    createSession: create,
    sessions: {
      list: sessionList,
      create,
      fork,
      refresh,
      refreshSubagents,
      retain,
      search,
      setSubagentCatalogOpen,
      using,
    },
    workspaces: {
      list: workspaceList,
      create: createWorkspace,
      rename: renameWorkspace,
      delete: deleteWorkspace,
      archiveSession,
      unarchiveSession,
    },
    conversation: {
      timeline: vi.fn(() => timelineSource),
    },
    changes: { list: listChanges, diff: readDiff },
    files: { list: listFiles, readDocument },
    commands: { list: listCommands },
    permissions: { catalog: permissionCatalog, current: permissionCurrent },
    mode: { plan: modePlan, goal: modeGoal, goalAction: modeGoalAction, ...(goalLimit ? { createGoal } : {}) },
    extensions: {
      currentPreset,
      plugins: listPlugins,
      presets: listPresets,
      selectPreset,
      skills: listSkills,
    },
    terminals: { create: createTerminal, list: listTerminals },
    schedules: { list: listSchedules },
    attachments: { prepare: prepareAttachments },
    interactions: {
      list: interactionSource,
      respond,
    },
    subagents: { prompt: subagentPrompt, interrupt: subagentInterrupt },
    locale: { get: localeGet, set: localeSet },
    connectionState: {
      getSnapshot: () => transport,
      subscribe: (listener: () => void) => {
        transportListeners.add(listener)
        return () => { transportListeners.delete(listener) }
      },
    },
  } as unknown as DshRuntimeFacades

  return {
    facades,
    adapter: createDshRuntimeAdapter(facades),
    createGoal,
    beginSubmission,
    cancel,
    create,
    fork,
    createWorkspace,
    createTerminal,
    currentPreset,
    deleteWorkspace,
    archiveSession,
    interactionSource,
    listChanges,
    listCommands,
    loadOlder,
    listFiles,
    listPlugins,
    listPresets,
    listSchedules,
    listSkills,
    listTerminals,
    localeGet,
    localeSet,
    modeGoal,
    modeGoalAction,
    modePlan,
    permissionCatalog,
    permissionCurrent,
    prompt,
    prepareAttachments,
    readAttachment,
    readDocument,
    readDiff,
    refreshSubagents,
    renameTask,
    renameWorkspace,
    release,
    retain,
    respond,
    runCommand,
    search,
    selectPreset,
    sessionList,
    setSubagentCatalogOpen,
    setSessionHistory: (hasMore: boolean) => {
      sessionHistory.hasMore = hasMore
      for (const listener of [...sessionListeners]) listener()
    },
    setRunning: (running: boolean) => { sessionHistory.running = running },
    subagentInterrupt,
    subagentPrompt,
    setTransport: (value: 'connected' | 'disconnected' | 'connecting' | undefined) => {
      transport = value
      for (const listener of [...transportListeners]) listener()
    },
    timelineSource,
    using,
    unarchiveSession,
    workspaceList,
  }
}

describe('DSH runtime adapter', () => {
  it('sends edited text and retained attachments through ordinary queue/steer admission', async () => {
    const { adapter, facades, timelineSource, prepareAttachments, readAttachment, prompt } = fixture()
    const prepare = vi.fn(async () => ({ ok: true as const, value: [{ type: 'file' as const, receiptId: 'original' }] }))
    Object.assign(facades, { messageActions: { prepareAttachments: prepare } })
    const original = timelineSource.getSnapshot()[0]!
    expect(await adapter.dispatch({ type: 'task.send-message', taskId: 'session-1', text: '修改后的问题', mode: 'steer', recordedAttachments: { seq: 12, attachmentIds: ['file'] }, requestId: 'edit-1' })).toMatchObject({ accepted: true })
    expect(prepare).toHaveBeenCalledWith('session-1', 12, ['file'])
    expect(timelineSource.getSnapshot()[0]).toBe(original)
    expect(prepareAttachments).toHaveBeenCalledWith('session-1', [])
    expect(readAttachment).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '修改后的问题' }, { type: 'file', receiptId: 'original' }], 'steer', undefined, 'submission-1')
  })

  it('rejects stale retry sources, missing messages and active turns before admission', async () => {
    const { adapter, setRunning, timelineSource, prompt } = fixture()
    const original = { ...timelineSource.getSnapshot()[0]!, seq: 12 }
    timelineSource.set([original, { ...original, itemId: 'later', seq: 16 }])
    const command = { type: 'task.resend-message' as const, taskId: 'session-1', itemId: original.itemId, requestId: 'resend-1' }
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: false, message: expect.stringContaining('结束') })
    setRunning(false)
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: false, message: expect.stringContaining('新消息') })
    expect(await adapter.dispatch({ ...command, itemId: 'missing' })).toMatchObject({ accepted: false, message: expect.stringContaining('找不到') })
    expect(prompt).not.toHaveBeenCalled()
    expect(await adapter.dispatch({ ...command, itemId: 'later' })).toMatchObject({ accepted: true })
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: original.text }], 'queue', undefined, 'submission-1')
  })

  it('reuses admission identity and staged attachments after an ambiguous transport failure', async () => {
    const { adapter, beginSubmission, prepareAttachments, prompt } = fixture()
    prompt.mockRejectedValueOnce(new Error('lost acknowledgement'))
    const command = { type: 'task.send-message' as const, taskId: 'session-1', text: '检查服务', requestId: 'same-attempt' }
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: false, retryable: true })
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: true })
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: true })
    expect(beginSubmission).toHaveBeenCalledTimes(1)
    expect(prepareAttachments).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledTimes(2)
    expect(prompt).toHaveBeenNthCalledWith(1, [{ type: 'text', text: '检查服务' }], 'queue', undefined, 'submission-1')
    expect(prompt).toHaveBeenNthCalledWith(2, [{ type: 'text', text: '检查服务' }], 'queue', undefined, 'submission-1')
  })

  it('reuses a newly created session when its first prompt admission needs a retry', async () => {
    const { adapter, create, prompt } = fixture()
    prompt.mockRejectedValueOnce(new Error('lost acknowledgement'))
    const command = { type: 'task.create' as const, prompt: '检查服务', requestId: 'same-first-send' }
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: false, retryable: true })
    expect(await adapter.dispatch(command)).toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('rechecks the latest question after loading recorded attachments for a retry', async () => {
    const { adapter, facades, setRunning, timelineSource, prompt } = fixture()
    setRunning(false)
    const original = { ...timelineSource.getSnapshot()[0]!, seq: 12, attachments: [{ attachmentId: 'file', name: 'report.txt', kind: 'file' as const }] }
    timelineSource.set([original])
    Object.assign(facades, { messageActions: { prepareAttachments: async () => {
      timelineSource.set([original, { ...original, itemId: 'new', seq: 16 }])
      return { ok: true, value: [{ type: 'file', receiptId: 'original' }] }
    } } })
    expect(await adapter.dispatch({ type: 'task.resend-message', taskId: 'session-1', itemId: original.itemId, requestId: 'resend-1' })).toMatchObject({ accepted: false, message: expect.stringContaining('新消息') })
    expect(prompt).not.toHaveBeenCalled()
  })

  it('binds a selected server before the first remote task prompt and uses the verified login directory', async () => {
    const { facades, create, prompt } = fixture()
    const bindTask = vi.fn(async () => ({ ok: true as const, value: { serverId: 'server-1', cwd: '/home/tester' } }))
    const broker = { status: vi.fn(async () => ({ trusted: true, credential: 'password' as const })),
      probe: vi.fn(async () => ({ home: '/home/tester' })), credentials: vi.fn(async () => {}) }
    Object.assign(globalThis, { __LING_SERVER_BROKER__: broker })
    try {
      const adapter = createDshRuntimeAdapter({ ...facades,
        servers: { bindTask, taskBinding: async () => ({ ok: true as const, value: null }) } as unknown as DshRuntimeFacades['servers'] })
      const result = await adapter.dispatch({ type: 'task.create', requestId: 'remote-create', prompt: '检查远端项目', serverId: 'server-1' })
      expect(result).toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
      expect(create).toHaveBeenCalledWith({})
      expect(bindTask).toHaveBeenCalledWith('session-created', 'server-1', '/home/tester')
      expect(bindTask.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
      expect(broker.credentials).not.toHaveBeenCalled()
    } finally { delete (globalThis as { __LING_SERVER_BROKER__?: unknown }).__LING_SERVER_BROKER__ }
  })

  it('attaches an operations server without moving a local workspace task to the remote server', async () => {
    const { facades, create, prompt } = fixture()
    const attachOperations = vi.fn(async () => ({ ok: true as const, value: { serverId: 'server-1', cwd: '/home/tester' } }))
    const broker = { status: vi.fn(async () => ({ trusted: true, credential: 'key' as const })),
      probe: vi.fn(async () => ({ home: '/home/tester' })), credentials: vi.fn(async () => {}) }
    Object.assign(globalThis, { __LING_SERVER_BROKER__: broker })
    try {
      const adapter = createDshRuntimeAdapter({ ...facades,
        servers: { attachOperations } as unknown as DshRuntimeFacades['servers'] })
      const result = await adapter.dispatch({ type: 'task.create', requestId: 'local-ops', prompt: '查看远端状态', workspaceId: 'workspace-1', operationsServerId: 'server-1' })
      expect(result).toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
      expect(create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
      expect(attachOperations).toHaveBeenCalledWith('session-created', 'server-1', '/home/tester')
      expect(attachOperations.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
      expect(broker.credentials).not.toHaveBeenCalled()
    } finally { delete (globalThis as { __LING_SERVER_BROKER__?: unknown }).__LING_SERVER_BROKER__ }
  })

  it('does not create a remote task when fingerprint confirmation remains incomplete', async () => {
    const { facades, create } = fixture()
    const broker = { status: vi.fn(async () => ({ trusted: false, credential: 'none' as const })),
      probe: vi.fn(async () => ({ home: '/home/tester' })), credentials: vi.fn(async () => {}) }
    Object.assign(globalThis, { __LING_SERVER_BROKER__: broker })
    try {
      const adapter = createDshRuntimeAdapter({ ...facades, servers: { bindTask: vi.fn() } as unknown as DshRuntimeFacades['servers'] })
      await expect(adapter.dispatch({ type: 'task.create', requestId: 'untrusted', prompt: '检查远端项目', serverId: 'server-1' })).resolves.toMatchObject({ accepted: false })
      expect(broker.credentials).toHaveBeenCalledOnce()
      expect(create).not.toHaveBeenCalled()
    } finally { delete (globalThis as { __LING_SERVER_BROKER__?: unknown }).__LING_SERVER_BROKER__ }
  })

  it('resolves Git workspace IDs before accessing native paths', async () => {
    const request = vi.fn(async () => ({ ok: false as const, reason: 'runtime-unavailable' as const, message: 'test', retryable: false }))
    const adapter = createDshRuntimeAdapter({
      workspaces: { list: new Source({ items: [{ workspaceId: 'git-workspace', path: '/work/git', name: 'Git' }] }) },
      workspaceGit: { request, branch: async () => 'main' },
    } as unknown as DshRuntimeFacades)
    await adapter.workspaceGit?.('git-workspace', { type: 'inspect' })
    expect(request).toHaveBeenCalledWith('/work/git', { type: 'inspect' })
    await adapter.workspaceGit?.('/outside/path', { type: 'commit', message: 'no' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('projects the DSH workspace and session catalogs', async () => {
    const { adapter } = fixture()

    await expect(adapter.getSnapshot()).resolves.toEqual({
      connection: { phase: 'ready' },
      workspaces: [{
        workspaceId: 'workspace-1',
        label: 'LING',
        locationLabel: '/work/ling',
      }],
      tasks: [{
        taskId: 'session-1',
        title: '实现 Renderer',
        status: 'running',
        archived: false,
        updatedAt: '2025-09-21T00:00:00.000Z',
        workspaceId: 'workspace-1',
      }],
      pendingInteractions: [],
      backgroundJobs: {},
      subagents: {},
    })
  })

  it('projects background jobs and subagent catalogs carried by the session list', async () => {
    const { adapter, sessionList } = fixture()
    sessionList.set({
      ids: ['session-1', 'session-2'],
      byId: {
        'session-1': {
          id: 'session-1',
          displayTitle: '实现 Renderer', title: '实现 Renderer',
          running: true,
          retainedBy: {},
          blank: false,
          updatedAt: 1_758_412_800_000,
        },
        'session-2': {
          id: 'session-2',
          displayTitle: '审查改动', title: '审查改动',
          parentId: 'session-1',
          origin: 'subagent',
          running: false,
          retainedBy: {},
          blank: false,
          updatedAt: 1_758_412_801_000,
        },
      },
      phase: 'ready',
      subagentsByParent: {
        'session-1': {
          entries: [
            {
              kind: 'child',
              id: 'session-2',
              activity: 'running',
              hasChildren: false,
              mode: 'continuable',
              label: '审查改动',
            },
            { kind: 'child', id: 'session-4', activity: 'inactive', hasChildren: true, mode: 'one-shot' },
            { kind: 'diagnostic', id: 'session-5', reason: 'corrupt' },
          ],
          state: 'ready',
          error: null,
        },
      },
      jobsBySession: {
        'session-1': [{
          id: 'job-1',
          kind: 'bash',
          label: 'corepack yarn check',
          status: 'running',
          detail: 'pid 4242',
          startedAt: 1_758_412_800_000,
        }, {
          id: 'job-2',
          kind: 'bash',
          label: 'git push',
          status: 'failed',
          startedAt: 1_758_412_799_000,
          finishedAt: 1_758_412_800_500,
        }],
      },
    })

    const snapshot = await adapter.getSnapshot()

    expect(snapshot.tasks.map(task => task.taskId)).toEqual(['session-1'])
    expect(snapshot.backgroundJobs).toEqual({
      'session-1': [{
        jobId: 'job-1',
        kind: 'bash',
        label: 'corepack yarn check',
        status: 'running',
        detail: 'pid 4242',
        startedAt: 1_758_412_800_000,
      }, {
        jobId: 'job-2',
        kind: 'bash',
        label: 'git push',
        status: 'failed',
        startedAt: 1_758_412_799_000,
        finishedAt: 1_758_412_800_500,
      }],
    })
    expect(snapshot.subagents['session-1']).toEqual({
      state: 'ready',
      subagents: [{
        sessionId: 'session-2',
        title: '审查改动',
        activity: 'running',
        mode: 'continuable',
        hasChildren: false,
      }, {
        sessionId: 'session-4',
        title: 'session-4',
        activity: 'inactive',
        mode: 'one-shot',
        hasChildren: true,
      }],
      unreadable: ['session-5'],
    })
  })

  it('surfaces a subagent catalog read failure', async () => {
    const { adapter, sessionList } = fixture()
    sessionList.set({
      ids: ['session-1'],
      byId: {
        'session-1': {
          id: 'session-1',
          displayTitle: '实现 Renderer', title: '实现 Renderer',
          running: true,
          retainedBy: {},
          blank: false,
          updatedAt: 1_758_412_800_000,
        },
      },
      phase: 'ready',
      subagentsByParent: {
        'session-1': {
          entries: [],
          state: 'error',
          error: { code: 'REMOTE_FAILURE', message: '子任务目录读取失败' },
        },
      },
      jobsBySession: {},
    })

    await expect(adapter.getSnapshot()).resolves.toMatchObject({
      subagents: {
        'session-1': {
          state: 'error',
          subagents: [],
          unreadable: [],
          message: '子任务目录读取失败',
        },
      },
    })
  })

  it('opens and re-reads the subagent catalog through the session controller', async () => {
    const { adapter, refreshSubagents, setSubagentCatalogOpen } = fixture()

    adapter.setTaskSubagentsOpen?.('session-1', true)
    expect(setSubagentCatalogOpen).toHaveBeenCalledWith('session-1', true)
    adapter.setTaskSubagentsOpen?.('session-1', false)
    expect(setSubagentCatalogOpen).toHaveBeenLastCalledWith('session-1', false)

    await expect(adapter.refreshTaskSubagents?.('session-1')).resolves.toEqual({ ok: true, value: undefined })
    expect(refreshSubagents).toHaveBeenCalledWith('session-1')

    refreshSubagents.mockRejectedValueOnce(new Error('offline'))
    await expect(adapter.refreshTaskSubagents?.('session-1')).resolves.toMatchObject({
      ok: false,
      reason: 'runtime-unavailable',
      retryable: true,
    })
  })

  it('lists workspace directories and reads preview documents through the files facade', async () => {
    const { adapter, listFiles, readDocument } = fixture()
    const controller = new AbortController()

    await expect(adapter.listWorkspaceDirectory?.('session-1', 'src', controller.signal)).resolves.toEqual({
      ok: true,
      value: {
        path: 'src',
        entries: [{ name: 'app.ts', path: 'src/app.ts', kind: 'file', bytes: 24 }],
        truncated: false,
      },
    })
    expect(listFiles).toHaveBeenCalledWith('session-1', 'src', controller.signal)

    await expect(adapter.readWorkspaceDocument?.('session-1', 'src/app.ts', controller.signal)).resolves.toEqual({
      ok: true,
      value: {
        path: 'src/app.ts',
        kind: 'code',
        mediaType: 'text/plain',
        text: 'export const value = 1\n',
        lines: 1,
        truncated: false,
        bytes: 24,
      },
    })
    expect(readDocument).toHaveBeenCalledWith('session-1', 'src/app.ts', controller.signal)
  })

  it('reports workspace files unavailable when the facade is absent', async () => {
    const adapter = createDshRuntimeAdapter({} as unknown as DshRuntimeFacades)

    await expect(adapter.listWorkspaceDirectory?.('session-1', 'src')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '工作区文件暂时不可用。',
      retryable: true,
    })
    await expect(adapter.readWorkspaceDocument?.('session-1', 'src/app.ts')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '工作区文件暂时不可用。',
      retryable: true,
    })
  })

  it('re-reads a historical attachment through the session binding', async () => {
    const { adapter, readAttachment, using } = fixture()

    await expect(adapter.getTaskAttachment?.('session-1', 'sha256:image-1')).resolves.toEqual({
      ok: true,
      value: { mediaType: 'image/png', data: new Uint8Array([137, 80, 78, 71]) },
    })
    expect(using).toHaveBeenCalledWith('session-1', { source: 'lingRenderer' }, expect.any(Function))
    expect(readAttachment).toHaveBeenCalledWith('sha256:image-1')
  })

  it('propagates a rejected attachment read', async () => {
    const { adapter, readAttachment } = fixture()
    readAttachment.mockResolvedValueOnce({
      ok: false,
      error: { code: 'session/attachment-invalid', message: '该附件不再可用。' },
    } as never)

    await expect(adapter.getTaskAttachment?.('session-1', 'sha256:file-1')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '该附件不再可用。',
      retryable: false,
    })
  })

  it('reports an attachment read unavailable when the session facade is absent', async () => {
    const adapter = createDshRuntimeAdapter({} as unknown as DshRuntimeFacades)

    await expect(adapter.getTaskAttachment?.('session-1', 'sha256:image-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '无法读取附件内容。',
      retryable: true,
    })
  })

  it('reads the slash command catalog through the commands facade', async () => {
    const { adapter, listCommands } = fixture()

    await expect(adapter.getTaskCommands?.('session-1')).resolves.toEqual({
      ok: true,
      value: [
        { name: 'compact', description: '压缩当前上下文' },
        { name: 'permission', description: '切换权限预设', hint: '<preset>' },
      ],
    })
    expect(listCommands).toHaveBeenCalledWith('session-1')
  })

  it('combines the permission catalog with the session current preset', async () => {
    const { adapter, permissionCatalog, permissionCurrent, using } = fixture()

    await expect(adapter.getTaskPermissions?.('session-1')).resolves.toEqual({
      ok: true,
      value: {
        currentValue: 'auto',
        options: [
          { label: '只读', value: 'read-only' },
          { description: '工具自动放行', label: '自动放行', value: 'auto' },
        ],
      },
    })
    expect(permissionCatalog).toHaveBeenCalledOnce()
    expect(using).toHaveBeenCalledWith('session-1', { source: 'lingRenderer' }, expect.any(Function))
    expect(permissionCurrent).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
  })

  it('applies a new task permission before its first prompt', async () => {
    const { adapter, create, permissionCatalog, prompt, runCommand } = fixture()

    await expect(adapter.getPermissionCatalog?.()).resolves.toMatchObject({ ok: true })
    await expect(adapter.dispatch({
      type: 'task.create',
      requestId: 'permission-create',
      prompt: '检查构建',
      permissionPreset: 'read-only',
    })).resolves.toMatchObject({ accepted: true, output: { taskId: 'session-created' } })

    expect(permissionCatalog).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledWith('/permission read-only')
    expect(runCommand.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0] ?? Infinity)
  })

  it('rejects an unavailable permission without creating a task', async () => {
    const { adapter, create } = fixture()

    await expect(adapter.dispatch({
      type: 'task.create',
      requestId: 'invalid-permission',
      prompt: '检查构建',
      permissionPreset: 'missing',
    })).resolves.toMatchObject({ accepted: false, reason: 'invalid-command' })
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['goal', 'plan'])('executes a new task %s mode through the command endpoint', async mode => {
    const { adapter, prompt, runCommand } = fixture()
    await expect(adapter.dispatch({
      type: 'task.create', requestId: `mode-${mode}`, prompt: `/${mode} 检查构建`,
      permissionPreset: 'read-only',
    })).resolves.toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
    expect(runCommand).toHaveBeenNthCalledWith(1, '/permission read-only')
    expect(runCommand).toHaveBeenNthCalledWith(2, `/${mode} 检查构建`)
    expect(prompt).not.toHaveBeenCalled()
  })

  it('propagates a failed permission catalog read', async () => {
    const { adapter, permissionCatalog, permissionCurrent } = fixture()
    permissionCatalog.mockResolvedValueOnce({
      ok: false,
      reason: 'runtime-unavailable',
      message: '权限预设暂时不可用。',
      retryable: true,
    } as never)

    await expect(adapter.getTaskPermissions?.('session-1')).resolves.toMatchObject({
      ok: false,
      message: '权限预设暂时不可用。',
    })
    expect(permissionCurrent).not.toHaveBeenCalled()
  })

  it('combines the plan projection with the session goal', async () => {
    const { adapter, modeGoal, modePlan, using } = fixture()

    await expect(adapter.getTaskMode?.('session-1')).resolves.toEqual({
      ok: true,
      value: {
        planActive: true,
        planPending: false,
        goal: {
          goalId: 'goal-1',
          revision: 3,
          objective: '修复全部门禁',
          phase: 'active',
          roundsStarted: 2,
          maxGoalRounds: 8,
        },
      },
    })
    expect(using).toHaveBeenCalledWith('session-1', { source: 'lingRenderer' }, expect.any(Function))
    expect(modePlan).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
    expect(modeGoal).toHaveBeenCalledWith('session-1')
  })

  it('omits plan fields when the projection is absent and goal fields when none is set', async () => {
    const { adapter, modeGoal, modePlan } = fixture()
    modePlan.mockReturnValueOnce(undefined)
    modeGoal.mockResolvedValueOnce({ ok: true, value: undefined } as never)

    await expect(adapter.getTaskMode?.('session-1')).resolves.toEqual({ ok: true, value: {} })
  })

  it('propagates a failed goal read', async () => {
    const { adapter, modeGoal } = fixture()
    modeGoal.mockResolvedValueOnce({
      ok: false,
      reason: 'runtime-unavailable',
      message: '任务目标暂时不可用。',
      retryable: true,
    } as never)

    await expect(adapter.getTaskMode?.('session-1')).resolves.toMatchObject({
      ok: false,
      message: '任务目标暂时不可用。',
    })
  })

  it('dispatches goal lifecycle actions through the mode facade', async () => {
    const { adapter, modeGoalAction } = fixture()

    await expect(adapter.dispatch({
      type: 'task.goal-action',
      requestId: 'req-1',
      taskId: 'session-1',
      action: 'pause',
      goalId: 'goal-1',
      revision: 3,
    })).resolves.toEqual({ accepted: true, requestId: 'req-1' })
    expect(modeGoalAction).toHaveBeenCalledWith('session-1', 'pause', 'goal-1', 3)
  })

  it('rejects a goal action when a remote reports failure', async () => {
    const { adapter, modeGoalAction } = fixture()
    modeGoalAction.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid-command',
      message: '目标已被更新。',
      retryable: false,
    } as never)

    await expect(adapter.dispatch({
      type: 'task.goal-action',
      requestId: 'req-2',
      taskId: 'session-1',
      action: 'complete',
      goalId: 'goal-1',
      revision: 2,
    })).resolves.toMatchObject({
      accepted: false,
      reason: 'invalid-command',
      message: '目标已被更新。',
    })
  })

  it('projects live transport state into the connection phase', async () => {
    const { adapter, setTransport } = fixture()
    const connections: LingRuntimeSnapshot['connection'][] = []
    const dispose = adapter.subscribe(event => {
      if (event.type === 'snapshot.replaced') connections.push(event.snapshot.connection)
    })

    setTransport('disconnected')
    setTransport('connecting')
    setTransport('connected')
    expect(connections).toEqual([
      { phase: 'failed', message: '与宿主的连接已断开。' },
      { phase: 'connecting', message: '正在重连…' },
      { phase: 'ready' },
    ])

    dispose()
    setTransport('disconnected')
    expect(connections).toHaveLength(3)
    await expect(adapter.getSnapshot()).resolves.toMatchObject({
      connection: { phase: 'failed', message: '与宿主的连接已断开。' },
    })
    setTransport(undefined)
  })

  it('projects pending interactions and marks their tasks as waiting for input', async () => {
    const { adapter, interactionSource } = fixture()
    interactionSource.set([{
      interactionId: 'approval-1',
      taskId: 'session-1',
      kind: 'approval',
      toolName: 'bash',
      reason: '需要访问构建目录',
    }])

    await expect(adapter.getSnapshot()).resolves.toMatchObject({
      tasks: [{ taskId: 'session-1', status: 'waiting-for-input' }],
      pendingInteractions: [{ interactionId: 'approval-1', toolName: 'bash' }],
    })
  })

  it('publishes a replacement snapshot when pending interactions change', () => {
    const { adapter, interactionSource } = fixture()
    const listener = vi.fn()
    const unsubscribe = adapter.subscribe(listener)

    interactionSource.set([{
      interactionId: 'question-1',
      taskId: 'session-1',
      kind: 'question',
      questions: [],
    }])

    expect(listener).toHaveBeenCalledWith({
      type: 'snapshot.replaced',
      snapshot: expect.objectContaining({
        tasks: [expect.objectContaining({ status: 'waiting-for-input' })],
        pendingInteractions: [expect.objectContaining({ interactionId: 'question-1' })],
      }),
    })
    unsubscribe()
  })

  it('uses the DSH session ownership and prompt path for renderer commands', async () => {
    const { adapter, beginSubmission, create, prompt, using } = fixture()

    await expect(adapter.dispatch({
      type: 'task.create',
      requestId: 'request-1',
      workspaceId: 'workspace-1',
      prompt: '检查构建',
    })).resolves.toEqual({
      accepted: true,
      requestId: 'request-1',
      output: { taskId: 'session-created' },
    })

    expect(create).toHaveBeenCalledWith({ workspaceId: 'workspace-1' })
    expect(using).toHaveBeenCalledWith(
      'session-created',
      { source: 'lingRenderer' },
      expect.any(Function),
    )
    expect(beginSubmission).toHaveBeenCalledWith({
      mode: 'queue',
      text: '检查构建',
      attachments: [],
    })
    expect(prompt).toHaveBeenCalledWith(
      [{ type: 'text', text: '检查构建' }],
      'queue',
      undefined,
      'submission-1',
    )
  })

  it('reads and follows the retained conversation projection', async () => {
    const { adapter, release, retain, timelineSource } = fixture()

    await expect(adapter.getTaskTimeline('session-1')).resolves.toMatchObject([
      { kind: 'user-message', text: '继续实现' },
      { kind: 'tool-activity', title: 'terminal', text: '构建通过', status: 'completed' },
      { kind: 'assistant-message', text: '已经完成。', status: 'completed' },
    ])

    const listener = vi.fn()
    const unsubscribe = adapter.subscribeTaskTimeline('session-1', listener)
    await Promise.resolve()
    expect(retain).toHaveBeenCalledWith('session-1', {
      source: 'lingRenderer',
      signal: expect.any(AbortSignal),
    })
    expect(listener).toHaveBeenCalledOnce()

    timelineSource.set([])
    expect(listener).toHaveBeenLastCalledWith([])

    unsubscribe()
    expect(release).toHaveBeenCalledOnce()
  })

  it('projects the session history window as hasOlder on the task summary', async () => {
    const { adapter, setSessionHistory } = fixture()

    const unsubscribe = adapter.subscribeTaskTimeline('session-1', vi.fn())
    await Promise.resolve()

    expect((await adapter.getSnapshot()).tasks[0]?.hasOlder).toBeUndefined()

    setSessionHistory(true)
    expect((await adapter.getSnapshot()).tasks[0]?.hasOlder).toBe(true)

    setSessionHistory(false)
    expect((await adapter.getSnapshot()).tasks[0]?.hasOlder).toBeUndefined()

    unsubscribe()
    expect((await adapter.getSnapshot()).tasks[0]?.hasOlder).toBeUndefined()
  })

  it('searches tasks through the host index and enriches catalog metadata', async () => {
    const { adapter, search } = fixture()
    const abort = new AbortController()

    await expect(adapter.searchTasks(' renderer ', abort.signal)).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          taskId: 'session-1',
          snippet: '…继续实现 renderer…',
          title: '实现 Renderer',
          workspaceId: 'workspace-1',
        }],
        hasMore: false,
      },
    })
    expect(search).toHaveBeenCalledWith('renderer', abort.signal)
  })

  it('projects only valid provider-reported token usage from the session catalog', async () => {
    const { adapter, sessionList } = fixture()
    const list = sessionList.getSnapshot()
    const summary = list.byId['session-1']!
    sessionList.set({
      ...list,
      byId: { ...list.byId, 'session-1': { ...summary, projectionValues: {
        tokenUsage: { uncachedInputTokens: 120, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 40 },
      } } },
    })

    expect((await adapter.getSnapshot()).tasks[0]?.tokenUsage).toEqual({
      uncachedInputTokens: 120,
      cacheReadTokens: 30,
      cacheWriteTokens: 10,
      outputTokens: 40,
    })

    sessionList.set({
      ...list,
      byId: { ...list.byId, 'session-1': { ...summary, projectionValues: {
        tokenUsage: { uncachedInputTokens: -1, cacheReadTokens: 30, cacheWriteTokens: 10, outputTokens: 40 },
      } } },
    })
    expect((await adapter.getSnapshot()).tasks[0]?.tokenUsage).toBeUndefined()
  })

  it('uses the session context projection separately from cumulative token usage', async () => {
    const { adapter, sessionList } = fixture()
    const list = sessionList.getSnapshot()
    const summary = list.byId['session-1']!
    sessionList.set({
      ...list,
      byId: { ...list.byId, 'session-1': { ...summary, projectionValues: {
        tokenUsage: { uncachedInputTokens: 12_000, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 400 },
        contextPressure: { pressureTokens: 3_100, projectedTokens: 3_280, contextWindow: 4_000 },
        contextBreakdown: { systemTokens: 400, toolsTokens: 480, messageTokens: 2_400 },
      } } },
    })

    const task = (await adapter.getSnapshot()).tasks[0]
    expect(task?.contextPressure).toEqual({ pressureTokens: 3_100, projectedTokens: 3_280, contextWindow: 4_000 })
    expect(task?.contextBreakdown).toEqual({ systemTokens: 400, toolsTokens: 480, messageTokens: 2_400 })
    expect(task?.tokenUsage?.uncachedInputTokens).toBe(12_000)

    sessionList.set({
      ...list,
      byId: { ...list.byId, 'session-1': { ...summary, projectionValues: {
        contextPressure: { projectedTokens: -1, contextWindow: 4_000 },
        contextBreakdown: { systemTokens: 400, toolsTokens: NaN, messageTokens: 2_400 },
      } } },
    })
    expect((await adapter.getSnapshot()).tasks[0]?.contextPressure).toBeUndefined()
    expect((await adapter.getSnapshot()).tasks[0]?.contextBreakdown).toBeUndefined()
  })

  it('matches task titles when the host index has no message hit', async () => {
    const { adapter, search } = fixture()
    search.mockResolvedValueOnce({ ok: true, value: { items: [], hasMore: false } })

    await expect(adapter.searchTasks('Renderer')).resolves.toEqual({
      ok: true,
      value: {
        items: [{
          taskId: 'session-1',
          snippet: '实现 Renderer',
          title: '实现 Renderer',
          workspaceId: 'workspace-1',
        }],
        hasMore: false,
      },
    })
  })

  it('matches workspace names and paths when the host index has no message hit', async () => {
    const { adapter, search } = fixture()
    search.mockResolvedValue({ ok: true, value: { items: [], hasMore: false } })

    const byName = await adapter.searchTasks('LING')
    expect(byName.ok && byName.value.items.map(item => item.taskId)).toEqual(['session-1'])

    const byPath = await adapter.searchTasks('/work/ling')
    expect(byPath.ok && byPath.value.items.map(item => item.taskId)).toEqual(['session-1'])
  })

  it('does not duplicate a task when its title and message both match', async () => {
    const { adapter } = fixture()
    const result = await adapter.searchTasks('Renderer')
    expect(result.ok && result.value.items.map(item => item.taskId)).toEqual(['session-1'])
  })

  it('forks a task through the session service and returns the new task identity', async () => {
    const { adapter, fork } = fixture()

    await expect(adapter.dispatch({
      type: 'task.fork',
      requestId: 'fork-1',
      taskId: 'session-1',
      atSeq: 7,
      increaseTitle: true,
    })).resolves.toEqual({
      accepted: true,
      requestId: 'fork-1',
      output: { taskId: 'session-forked' },
    })
    expect(fork).toHaveBeenCalledWith({
      sessionId: 'session-1',
      atSeq: 7,
      increaseTitle: true,
    })
  })

  it('retains the operations target when forking a local task', async () => {
    const { facades, fork } = fixture()
    const attachOperations = vi.fn(async () => ({ ok: true as const, value: { serverId: 'server-1', cwd: '/home/tester' } }))
    const adapter = createDshRuntimeAdapter({ ...facades,
      servers: {
        taskBinding: async () => ({ ok: true as const, value: null }),
        operationsBinding: async () => ({ ok: true as const, value: { serverId: 'server-1', cwd: '/home/tester' } }),
        attachOperations,
      } as unknown as DshRuntimeFacades['servers'] })
    await expect(adapter.dispatch({ type: 'task.fork', requestId: 'fork-ops', taskId: 'session-1' })).resolves.toMatchObject({ accepted: true, output: { taskId: 'session-forked' } })
    expect(fork).toHaveBeenCalledOnce()
    expect(attachOperations).toHaveBeenCalledWith('session-forked', 'server-1', '/home/tester')
  })

  it('reads turn changes and file diffs through the changes projection', async () => {
    const { adapter, listChanges, readDiff } = fixture()
    const abort = new AbortController()

    await expect(adapter.getTaskChanges('session-1', abort.signal)).resolves.toMatchObject({
      ok: true,
      value: [{ taskId: 'session-1', turn: 1, seq: 8, total: 1, added: 3, deleted: 1 }],
    })
    expect(listChanges).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }), abort.signal)

    await expect(adapter.getTaskFileDiff('session-1', 8, 0, abort.signal)).resolves.toMatchObject({
      ok: true,
      value: { kind: 'text', display: 'src/app.ts', coarse: false },
    })
    expect(readDiff).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }), 8, 0, abort.signal)
  })

  it('forks a task from a message anchor', async () => {
    const { adapter, fork } = fixture()
    await expect(adapter.dispatch({
      type: 'task.fork',
      requestId: 'fork-anchor',
      taskId: 'session-1',
      atSeq: 8,
    })).resolves.toMatchObject({
      accepted: true,
      requestId: 'fork-anchor',
      output: { taskId: 'session-forked' },
    })
    expect(fork).toHaveBeenCalledWith({ sessionId: 'session-1', atSeq: 8 })
  })

  it('prepares attachments before registering the local submission echo', async () => {
    const { adapter, beginSubmission, prepareAttachments, prompt } = fixture()
    prepareAttachments.mockResolvedValueOnce({
      content: [{ type: 'file', receiptId: 'receipt-1' }],
      pending: [{ type: 'file', value: { attachmentId: 'file-1', name: 'report.txt' } }],
    } as never)
    const attachment = {
      kind: 'file' as const,
      name: 'report.txt',
      data: new Uint8Array([1, 2, 3]),
    }

    await expect(adapter.dispatch({
      type: 'task.send-message',
      requestId: 'send-file',
      taskId: 'session-1',
      text: '检查附件',
      mode: 'steer',
      attachments: [attachment],
    })).resolves.toEqual({ accepted: true, requestId: 'send-file' })

    expect(prepareAttachments).toHaveBeenCalledWith('session-1', [attachment])
    expect(beginSubmission).toHaveBeenCalledWith({
      mode: 'steer',
      text: '检查附件',
      attachments: [{ type: 'file', value: { attachmentId: 'file-1', name: 'report.txt' } }],
    })
    expect(prompt).toHaveBeenCalledWith([
      { type: 'text', text: '检查附件' },
      { type: 'file', receiptId: 'receipt-1' },
    ], 'steer', undefined, 'submission-1')
  })

  it('maps transient prompt failures to a retryable send failure and abandons the submission', async () => {
    const { adapter, beginSubmission, prompt } = fixture()
    const abandon = vi.fn()
    beginSubmission.mockReturnValueOnce({ requestId: 'submission-1', abandon } as never)
    prompt.mockResolvedValueOnce({
      ok: false,
      error: { code: 'CLIENT_API', message: 'client api: session/prompt failed: Failed to fetch' },
    } as never)

    await expect(adapter.dispatch({
      type: 'task.send-message',
      requestId: 'send-transient',
      taskId: 'session-1',
      text: '重试验证',
      mode: 'queue',
      attachments: [],
    })).resolves.toEqual({
      accepted: false,
      requestId: 'send-transient',
      reason: 'runtime-unavailable',
      message: '无法发送消息。',
      retryable: true,
    })
    expect(abandon).toHaveBeenCalledTimes(1)
  })

  it('passes streaming projection fields through unchanged', async () => {
    const { adapter, timelineSource } = fixture()
    timelineSource.set([{
      itemId: 'session-1:assistant:stream',
      taskId: 'session-1',
      kind: 'assistant-message',
      text: '正在处理。',
      detail: '检查测试结果',
      createdAt: '2025-09-21T00:00:03.000Z',
      status: 'running',
      streaming: true,
    }])

    await expect(adapter.getTaskTimeline('session-1')).resolves.toMatchObject([
      {
        kind: 'assistant-message',
        text: '正在处理。',
        detail: '检查测试结果',
        status: 'running',
        streaming: true,
      },
    ])
  })

  it('dispatches task and workspace lifecycle operations through public DSH facades', async () => {
    const {
      adapter,
      archiveSession,
      createWorkspace,
      deleteWorkspace,
      loadOlder,
      renameTask,
      renameWorkspace,
      runCommand,
      unarchiveSession,
    } = fixture()

    const commands = [
      adapter.dispatch({ type: 'task.rename', requestId: '1', taskId: 'session-1', title: '新标题' }),
      adapter.dispatch({ type: 'task.load-older', requestId: '2', taskId: 'session-1' }),
      adapter.dispatch({ type: 'task.run-command', requestId: '3', taskId: 'session-1', line: '/compact' }),
      adapter.dispatch({ type: 'task.archive', requestId: '4', taskId: 'session-1' }),
      adapter.dispatch({ type: 'task.unarchive', requestId: '5', taskId: 'session-1' }),
      adapter.dispatch({ type: 'workspace.create', requestId: '6', path: '/work/new' }),
      adapter.dispatch({ type: 'workspace.rename', requestId: '7', workspaceId: 'workspace-1', title: '新工作区' }),
      adapter.dispatch({ type: 'workspace.delete', requestId: '8', workspaceId: 'workspace-1' }),
    ]

    await expect(Promise.all(commands)).resolves.toEqual(
      Array.from({ length: 8 }, (_, index) => ({ accepted: true, requestId: String(index + 1) })),
    )
    expect(renameTask).toHaveBeenCalledWith('新标题')
    expect(loadOlder).toHaveBeenCalledOnce()
    expect(runCommand).toHaveBeenCalledWith('/compact')
    expect(archiveSession).toHaveBeenCalledWith('session-1')
    expect(unarchiveSession).toHaveBeenCalledWith('session-1')
    expect(createWorkspace).toHaveBeenCalledWith({ path: '/work/new' })
    expect(renameWorkspace).toHaveBeenCalledWith('workspace-1', '新工作区')
    expect(deleteWorkspace).toHaveBeenCalledWith('workspace-1')
  })

  it('forwards interaction responses and rejects stale requests', async () => {
    const { adapter, respond } = fixture()
    const command = {
      type: 'interaction.answer-approval' as const,
      requestId: 'approval-answer',
      interactionId: 'approval-1',
      decision: 'allowed-once' as const,
    }

    await expect(adapter.dispatch(command)).resolves.toEqual({
      accepted: true,
      requestId: 'approval-answer',
    })
    expect(respond).toHaveBeenCalledWith(command)

    respond.mockResolvedValueOnce(false)
    await expect(adapter.dispatch({
      type: 'interaction.cancel',
      requestId: 'cancel-stale',
      interactionId: 'question-old',
    })).resolves.toMatchObject({
      accepted: false,
      reason: 'interaction-stale',
      retryable: false,
    })
  })

  it('reads the skill catalog and plugin inventory through the host extensions facade', async () => {
    const { adapter, listPlugins, listSkills } = fixture()
    const signal = new AbortController().signal

    await expect(adapter.getTaskSkills?.('session-1', signal)).resolves.toEqual({
      ok: true,
      value: [{ name: 'report', description: '生成报告', path: '/work/ling/skills/report', modelInvocable: true }],
    })
    expect(listSkills).toHaveBeenCalledWith('session-1', signal)

    await expect(adapter.listPlugins?.()).resolves.toEqual({
      ok: true,
      value: [{ id: '4', moduleName: '@deepseek-ai/dsh-doc', enabled: true, phase: 'active' }],
    })
    expect(listPlugins).toHaveBeenCalledWith()
  })

  it('reads session terminals and schedule reminders through the host facades', async () => {
    const { adapter, createTerminal, listSchedules, listTerminals } = fixture()

    await expect(adapter.getTaskTerminals?.('session-1')).resolves.toEqual({
      ok: true,
      value: [{ terminalId: 'term-1', title: 'shell 1', shell: 'zsh', cwd: '/work/ling', state: 'running' }],
    })
    expect(listTerminals).toHaveBeenCalledWith('session-1')

    await expect(adapter.createTaskTerminal?.('session-1')).resolves.toEqual({
      ok: true,
      value: { terminalId: 'term-2', title: 'shell 2', shell: 'zsh', cwd: '/work/ling', state: 'running' },
    })
    expect(createTerminal).toHaveBeenCalledWith('session-1')

    await expect(adapter.getTaskSchedules?.('session-1')).resolves.toEqual({
      ok: true,
      value: [{ scheduleId: 'sch-1', kind: 'at', prompt: '汇报进度', scheduledAt: '2026-09-22T15:00:00.000Z' }],
    })
    expect(listSchedules).toHaveBeenCalledTimes(1)
  })

  it('reports missing terminal and schedule facades as unavailable', async () => {
    const adapter = createDshRuntimeAdapter({} as unknown as DshRuntimeFacades)

    await expect(adapter.getTaskTerminals?.('session-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '终端列表暂时不可用。',
      retryable: true,
    })
    await expect(adapter.createTaskTerminal?.('session-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '终端列表暂时不可用。',
      retryable: true,
    })
    await expect(adapter.getTaskSchedules?.('session-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '定时提醒暂时不可用。',
      retryable: true,
    })
  })

  it('reads the default agent choice before creating a session', async () => {
    const { adapter, using } = fixture()
    await expect(adapter.getTaskAgentPresets?.()).resolves.toMatchObject({ ok: true, value: { currentValue: 'default' } })
    expect(using).not.toHaveBeenCalled()
  })

  it('passes the selected agent to session creation before any prompt is sent', async () => {
    const { adapter, create } = fixture()
    const result = await adapter.dispatch({ type: 'task.create', requestId: 'agent-create', prompt: '检查项目', workspaceId: 'workspace-1', agentPreset: 'reviewer' })
    expect(result.accepted).toBe(true)
    expect(create).toHaveBeenCalledWith({ workspaceId: 'workspace-1', agentPreset: 'reviewer' })
  })

  it('does not fall back to another agent when creation refuses the selected preset', async () => {
    const { adapter, create, prompt } = fixture()
    create.mockRejectedValueOnce(new Error('preset missing'))
    const result = await adapter.dispatch({ type: 'task.create', requestId: 'bad-agent', prompt: '检查项目', agentPreset: 'gone' })
    expect(result.accepted).toBe(false)
    expect(create).toHaveBeenCalledOnce()
    expect(prompt).not.toHaveBeenCalled()
  })

  it('pairs the preset roster with the preset the session actually runs', async () => {
    const { adapter, currentPreset, listPresets, using } = fixture()

    await expect(adapter.getTaskAgentPresets?.('session-1')).resolves.toEqual({
      ok: true,
      value: {
        options: [
          { id: 'default', label: '默认', isDefault: true, trust: 'system' },
          { id: 'reviewer', label: '评审助手', isDefault: false, trust: 'user' },
        ],
        currentValue: 'reviewer',
      },
    })
    expect(listPresets).toHaveBeenCalledWith()
    expect(using).toHaveBeenCalledWith('session-1', { source: 'lingRenderer' }, expect.any(Function))
    expect(currentPreset).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }))
  })

  it('omits the current preset when the session has not selected one', async () => {
    const { adapter, currentPreset, listPresets } = fixture()
    currentPreset.mockReturnValueOnce(undefined as never)
    const options = (await listPresets()).value

    await expect(adapter.getTaskAgentPresets?.('session-1')).resolves.toEqual({
      ok: true,
      value: { options },
    })
  })

  it('keeps a preset catalog failure a rejection instead of an empty roster', async () => {
    const { adapter, currentPreset, listPresets } = fixture()
    listPresets.mockResolvedValueOnce({
      ok: false,
      reason: 'runtime-unavailable',
      message: 'Agent 预设目录暂时不可用。',
      retryable: true,
    } as never)

    await expect(adapter.getTaskAgentPresets?.('session-1')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: 'Agent 预设目录暂时不可用。',
      retryable: true,
    })
    expect(currentPreset).not.toHaveBeenCalled()
  })

  it('routes a preset switch to the host and reports a locked session as a rejection', async () => {
    const { adapter, selectPreset } = fixture()
    const command = {
      type: 'task.select-agent-preset' as const,
      requestId: 'preset-switch',
      taskId: 'session-1',
      agentPreset: 'reviewer',
    }

    await expect(adapter.dispatch(command)).resolves.toEqual({ accepted: true, requestId: 'preset-switch' })
    expect(selectPreset).toHaveBeenCalledWith('session-1', 'reviewer')

    selectPreset.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid-command',
      message: '会话已经开始，无法切换预设。',
      retryable: false,
    } as never)
    await expect(adapter.dispatch(command)).resolves.toEqual({
      accepted: false,
      requestId: 'preset-switch',
      reason: 'invalid-command',
      message: '会话已经开始，无法切换预设。',
      retryable: false,
    })
  })

  it('sends subagent prompts and interrupts through the subagents facade', async () => {
    const { adapter, subagentInterrupt, subagentPrompt } = fixture()

    await expect(adapter.promptTaskSubagent?.('session-1', 'session-2', '补充测试要点')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(subagentPrompt).toHaveBeenCalledWith('session-1', 'session-2', '补充测试要点')

    await expect(adapter.interruptTaskSubagent?.('session-1', 'session-2')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(subagentInterrupt).toHaveBeenCalledWith('session-1', 'session-2')
  })

  it('keeps a subagent action rejection and turns a thrown failure into unavailability', async () => {
    const { adapter, subagentInterrupt, subagentPrompt } = fixture()
    subagentPrompt.mockResolvedValueOnce({
      ok: false,
      reason: 'invalid-command',
      message: '该子任务不支持追加指令。',
      retryable: false,
    } as never)

    await expect(adapter.promptTaskSubagent?.('session-1', 'session-2', '继续')).resolves.toEqual({
      ok: false,
      reason: 'invalid-command',
      message: '该子任务不支持追加指令。',
      retryable: false,
    })

    subagentInterrupt.mockRejectedValueOnce(new Error('offline') as never)
    await expect(adapter.interruptTaskSubagent?.('session-1', 'session-2')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '中断子任务暂时不可用。',
      retryable: true,
    })
  })

  it('reads and stores the language preference through the locale facade', async () => {
    const { adapter, localeGet, localeSet } = fixture()

    await expect(adapter.getLocalePreference?.()).resolves.toEqual({ ok: true, value: { preference: 'zh' } })
    await expect(adapter.setLocalePreference?.('en')).resolves.toEqual({ ok: true, value: undefined })
    expect(localeSet).toHaveBeenCalledWith('en')
    await expect(adapter.setLocalePreference?.(undefined)).resolves.toEqual({ ok: true, value: undefined })
    expect(localeSet).toHaveBeenLastCalledWith(undefined)

    localeGet.mockRejectedValueOnce(new Error('offline') as never)
    await expect(adapter.getLocalePreference?.()).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '无法读取语言设置。',
      retryable: true,
    })
  })

  it('reports missing subagent and locale facades as unavailable', async () => {
    const adapter = createDshRuntimeAdapter({} as unknown as DshRuntimeFacades)

    await expect(adapter.promptTaskSubagent?.('session-1', 'session-2', '继续')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '子任务操作暂时不可用。',
      retryable: true,
    })
    await expect(adapter.interruptTaskSubagent?.('session-1', 'session-2')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '子任务操作暂时不可用。',
      retryable: true,
    })
    await expect(adapter.getLocalePreference?.()).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '语言设置暂时不可用。',
      retryable: true,
    })
    await expect(adapter.setLocalePreference?.('zh')).resolves.toEqual({
      ok: false,
      reason: 'runtime-unavailable',
      message: '语言设置暂时不可用。',
      retryable: true,
    })
  })
})

 describe('goal round preferences', () => {
  it('routes new and existing goals through the capped domain endpoint', async () => {
    const { adapter, createGoal, runCommand, prompt } = fixture(true)
    expect(adapter.supportsGoalLimit).toBe(true)
    await expect(adapter.dispatch({ type: 'task.create', requestId: 'goal-new', prompt: '/goal 修复全部问题', maxGoalRounds: 10, permissionPreset: 'read-only' })).resolves.toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
    expect(createGoal).toHaveBeenCalledWith('session-created', '修复全部问题', 10)
    expect(runCommand).toHaveBeenCalledExactlyOnceWith('/permission read-only')
    expect(prompt).not.toHaveBeenCalled()
    await adapter.dispatch({ type: 'task.run-command', requestId: 'goal-existing', taskId: 'session-1', line: '/goal 再检查', maxGoalRounds: 50 })
    expect(createGoal).toHaveBeenLastCalledWith('session-1', '再检查', 50)
    await adapter.dispatch({ type: 'task.run-command', requestId: 'goal-pause', taskId: 'session-1', line: '/goal pause', maxGoalRounds: 50 })
    expect(runCommand).toHaveBeenLastCalledWith('/goal pause')
  })
  it('rejects invalid caps and unsupported runtimes before creating a task', async () => {
    const { adapter, create } = fixture()
    for (const maxGoalRounds of [0, 257, 1.5, 20]) {
      await expect(adapter.dispatch({ type: 'task.create', requestId: 'bad', prompt: '/goal Fix', maxGoalRounds })).resolves.toMatchObject({ accepted: false })
    }
    expect(create).not.toHaveBeenCalled()
  })
})

it('returns the canonical workspace identity when adopting a worktree directory', async () => {
  const { adapter, createWorkspace, create } = fixture()
  createWorkspace.mockResolvedValueOnce({ workspaceId: 'canonical-tree', path: '/resolved/tree' })
  await expect(adapter.dispatch({ type: 'workspace.create', requestId: 'adopt', path: '/symlink/tree/' })).resolves.toEqual({ accepted: true, requestId: 'adopt', output: { workspaceId: 'canonical-tree' } })
  await adapter.dispatch({ type: 'task.create', requestId: 'in-tree', workspaceId: 'canonical-tree', prompt: '检查工作树' })
  expect(create).toHaveBeenCalledExactlyOnceWith({ workspaceId: 'canonical-tree' })
})

describe('side task model isolation', () => {
  it('sets only the new session model before sending its first prompt', async () => {
    const { facades, create, prompt } = fixture()
    const select = vi.fn(async () => ({ ok: true as const, value: undefined }))
    const defaultModel = vi.fn()
    const adapter = createDshRuntimeAdapter({ ...facades, models: { ...facades.models, selectDefault: defaultModel } as NonNullable<DshRuntimeFacades['models']>, taskModels: { canSelect: () => true, select, watch: () => new Source(undefined) } })
    const model = { provider: 'provider', model: 'model', thinking: 'high' }
    expect(await adapter.dispatch({ type: 'task.create', requestId: 'side', prompt: 'Side task', model })).toMatchObject({ accepted: true, output: { taskId: 'session-created' } })
    expect(select).toHaveBeenCalledWith('session-created', model)
    expect(create.mock.invocationCallOrder[0]).toBeLessThan(select.mock.invocationCallOrder[0]!)
    expect(select.mock.invocationCallOrder[0]).toBeLessThan(prompt.mock.invocationCallOrder[0]!)
    expect(defaultModel).not.toHaveBeenCalled()
  })
  it('does not send using the wrong model when selection fails', async () => {
    const { facades, prompt } = fixture()
    const adapter = createDshRuntimeAdapter({ ...facades, taskModels: { canSelect: () => true, select: async () => ({ ok: false, reason: 'invalid-command', message: 'Unavailable model', retryable: false }), watch: () => new Source(undefined) } })
    expect(await adapter.dispatch({ type: 'task.create', requestId: 'side', prompt: 'Do not send', model: { provider: 'missing', model: 'missing' } })).toMatchObject({ accepted: false, message: 'Unavailable model' })
    expect(prompt).not.toHaveBeenCalled()
  })
  it('rejects unsupported model selection before creating a blank session', async () => {
    const { adapter, create } = fixture()
    expect(await adapter.dispatch({ type: 'task.create', requestId: 'side', prompt: 'Do not create', model: { provider: 'missing', model: 'missing' } })).toMatchObject({ accepted: false })
    expect(create).not.toHaveBeenCalled()
  })
})

it('keeps shared session history and subagent observation while another pane remains open', async () => {
  const { adapter, setSessionHistory, setSubagentCatalogOpen } = fixture()
  setSessionHistory(true)
  const first = adapter.subscribeTaskTimeline('session-1', () => {})
  const second = adapter.subscribeTaskTimeline('session-1', () => {})
  await new Promise(resolve => setTimeout(resolve, 0))
  adapter.setTaskSubagentsOpen?.('session-1', true)
  adapter.setTaskSubagentsOpen?.('session-1', true)
  first(); first()
  adapter.setTaskSubagentsOpen?.('session-1', false)
  expect((await adapter.getSnapshot()).tasks.find(task => task.taskId === 'session-1')?.hasOlder).toBe(true)
  expect(setSubagentCatalogOpen.mock.calls).toEqual([['session-1', true]])
  second(); adapter.setTaskSubagentsOpen?.('session-1', false)
  expect(setSubagentCatalogOpen.mock.calls).toEqual([['session-1', true], ['session-1', false]])
})


describe('new task history', () => {
  it('does not create a conversation for empty input', async () => {
    const { adapter, create } = fixture()
    expect(await adapter.dispatch({ type: 'task.create', requestId: 'empty', prompt: '  \n ' })).toMatchObject({ accepted: false })
    expect(create).not.toHaveBeenCalled()
  })

  it('keeps unsent and rejected drafts out of history and never uses the workspace as their title', async () => {
    const { adapter, sessionList, prompt } = fixture()
    const previous = sessionList.getSnapshot()
    sessionList.set({ ...previous, ids: [...previous.ids, 'session-created'], byId: {
      ...previous.byId,
      'session-created': { id: 'session-created', cwd: '/work/atlas', displayTitle: 'atlas', blank: true, running: false, updatedAt: 1 },
    } })
    expect((await adapter.getSnapshot()).tasks.map(task => task.taskId)).toEqual(['session-1'])
    prompt.mockResolvedValueOnce({ ok: false, error: { code: 'transport/unavailable', message: 'offline' } } as never)
    expect(await adapter.dispatch({ type: 'task.create', requestId: 'failed-first', prompt: '检查代码' })).toMatchObject({ accepted: false })
    expect((await adapter.getSnapshot()).tasks.map(task => task.taskId)).toEqual(['session-1'])
    const saved = sessionList.getSnapshot()
    sessionList.set({ ...saved, byId: { ...saved.byId, 'session-created': { ...saved.byId['session-created'], blank: false } } })
    expect((await adapter.getSnapshot()).tasks.find(task => task.taskId === 'session-created')?.title).toBe('新任务')
    const sent = sessionList.getSnapshot()
    sessionList.set({ ...sent, byId: { ...sent.byId, 'session-created': { ...sent.byId['session-created'], title: '检查代码', displayTitle: '检查代码' } } })
    expect((await adapter.getSnapshot()).tasks.find(task => task.taskId === 'session-created')?.title).toBe('检查代码')
  })
})
