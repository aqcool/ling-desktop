import { describe, expect, it, vi } from 'vitest'
import type { LingTimelineItem } from '../src/runtime/contract.js'
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
  const beginSubmission = vi.fn(() => ({ requestId: 'submission-1', abandon: vi.fn() }))
  const binding = {
    sessionId: 'session-1',
    session: {
      getSnapshot: () => ({ running: true }),
      subscribe: () => () => {},
      beginSubmission,
      prompt,
      cancel,
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
  const facades = {
    sessions: { list: sessionList, create, refresh, retain, using },
    workspaces: { list: workspaceList },
    conversation: {
      timeline: vi.fn(() => timelineSource),
    },
  } as unknown as DshRuntimeFacades

  return {
    adapter: createDshRuntimeAdapter(facades),
    beginSubmission,
    cancel,
    create,
    prompt,
    release,
    retain,
    sessionList,
    timelineSource,
    using,
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
        updatedAt: '2025-09-21T00:00:00.000Z',
        workspaceId: 'workspace-1',
      }],
    })
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
})
