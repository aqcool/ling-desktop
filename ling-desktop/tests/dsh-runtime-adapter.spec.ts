import { describe, expect, it, vi } from 'vitest'
import type { LingPendingInteraction, LingTimelineItem } from '../src/runtime/contract.js'
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

function fixture() {
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
  const sessionList = new Source({
    ids: ['session-1'],
    byId: {
      'session-1': {
        id: 'session-1',
        displayTitle: '实现 Renderer',
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
  const beginSubmission = vi.fn(() => ({ requestId: 'submission-1', abandon: vi.fn() }))
  const binding = {
    sessionId: 'session-1',
    session: {
      getSnapshot: () => ({ running: true }),
      subscribe: () => () => {},
      beginSubmission,
      prompt,
      cancel,
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
  const refresh = vi.fn(async () => {})
  const createWorkspace = vi.fn(async () => ({}))
  const renameWorkspace = vi.fn(async () => ({}))
  const deleteWorkspace = vi.fn(async () => {})
  const archiveSession = vi.fn(async () => {})
  const unarchiveSession = vi.fn(async () => {})
  const interactionSource = new Source<readonly LingPendingInteraction[]>([])
  const respond = vi.fn(async () => true)
  const prepareAttachments = vi.fn(async () => ({ content: [], pending: [] }))
  const facades = {
    sessions: { list: sessionList, create, refresh, retain, using },
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
    attachments: { prepare: prepareAttachments },
    interactions: {
      list: interactionSource,
      respond,
    },
  } as unknown as DshRuntimeFacades

  return {
    adapter: createDshRuntimeAdapter(facades),
    beginSubmission,
    cancel,
    create,
    createWorkspace,
    deleteWorkspace,
    archiveSession,
    interactionSource,
    loadOlder,
    prompt,
    prepareAttachments,
    renameTask,
    renameWorkspace,
    release,
    retain,
    respond,
    runCommand,
    sessionList,
    timelineSource,
    using,
    unarchiveSession,
    workspaceList,
  }
}

describe('DSH runtime adapter', () => {
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
    })
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
    })).resolves.toEqual({ accepted: true, requestId: 'request-1' })

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
})
