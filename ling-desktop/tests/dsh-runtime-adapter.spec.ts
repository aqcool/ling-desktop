import { describe, expect, it, vi } from 'vitest'
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
  const eventSource = new Source({
    entries: [
      {
        type: 'event',
        event: {
          type: 'user/message',
          seq: 1,
          time: 1_758_412_800_000,
          data: { source: { kind: 'user' }, content: [{ type: 'text', text: '继续实现' }] },
        },
      },
      {
        type: 'event',
        event: {
          type: 'tool/call',
          seq: 2,
          time: 1_758_412_801_000,
          data: { name: 'terminal' },
        },
      },
      {
        type: 'event',
        event: {
          type: 'assistant/message',
          seq: 3,
          time: 1_758_412_802_000,
          data: { message: { content: [{ type: 'text', text: '已经完成。' }] } },
        },
      },
    ],
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
  } as unknown as DshRuntimeFacades

  return {
    adapter: createDshRuntimeAdapter(facades),
    beginSubmission,
    cancel,
    create,
    eventSource,
    prompt,
    release,
    retain,
    sessionList,
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

  it('reads and follows the retained DSH event source', async () => {
    const { adapter, eventSource, release, retain } = fixture()

    await expect(adapter.getTaskTimeline('session-1')).resolves.toMatchObject([
      { kind: 'user-message', text: '继续实现' },
      { kind: 'tool-activity', text: 'terminal' },
      { kind: 'assistant-message', text: '已经完成。' },
    ])

    const listener = vi.fn()
    const unsubscribe = adapter.subscribeTaskTimeline('session-1', listener)
    await Promise.resolve()
    expect(retain).toHaveBeenCalledWith('session-1', {
      source: 'lingRenderer',
      signal: expect.any(AbortSignal),
    })
    expect(listener).toHaveBeenCalledOnce()

    eventSource.set({
      ...eventSource.getSnapshot(),
      revision: 2,
      entries: [],
    })
    expect(listener).toHaveBeenLastCalledWith([])

    unsubscribe()
    expect(release).toHaveBeenCalledOnce()
  })
})
