// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { LingRuntimeAdapter, LingRuntimeEvent, LingRuntimeSnapshot, LingTimelineItem } from '../src/runtime/contract.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import { useLingRuntime } from '../src/runtime/use-ling-runtime.js'

let root: Root
let view: ReturnType<typeof useLingRuntime>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function Probe({ runtime }: { runtime: LingRuntimeAdapter }) {
  view = useLingRuntime(runtime, 'a')
  return null
}

function fixture() {
  const snapshot: LingRuntimeSnapshot = {
    connection: { phase: 'ready' }, workspaces: [], pendingInteractions: [], backgroundJobs: {}, subagents: {},
    tasks: ['a', 'b'].map(taskId => ({ taskId, title: taskId, archived: false, status: 'running', updatedAt: '2026-10-29' })),
  }
  const callbacks = new Map<string, (items: readonly LingTimelineItem[]) => void>()
  const listeners = new Set<(event: LingRuntimeEvent) => void>()
  const retry = vi.fn()
  const unsubscribe = vi.fn()
  const runtime: LingRuntimeAdapter = {
    ...createOfflineRuntimeAdapter(),
    getSnapshot: async () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    subscribeTaskTimeline(taskId, listener) { callbacks.set(taskId, listener); return unsubscribe },
    retryTaskTimeline: retry,
  }
  return { snapshot, runtime, callbacks, retry, unsubscribe, emit(next: LingRuntimeSnapshot) { for (const listener of listeners) listener({ type: 'snapshot.replaced', snapshot: next }) } }
}

it('keeps subscription health delivered before initial snapshot resolution', async () => {
  const { snapshot, runtime, emit, retry } = fixture()
  let resolveInitial!: (snapshot: LingRuntimeSnapshot) => void
  runtime.getSnapshot = () => new Promise(resolve => { resolveInitial = resolve })
  await act(async () => root.render(<Probe runtime={runtime} />))
  await act(async () => emit({ ...snapshot, taskTimelineSync: { a: { phase: 'failed', message: '消息恢复失败' } } }))
  expect(view.timelineSync?.phase).toBe('failed')
  await act(async () => resolveInitial(snapshot))
  expect(view.timelineSync?.phase).toBe('failed')
  expect(view.selectedTask?.status).toBe('running')
  expect(view.connection.phase).toBe('ready')
  view.retryTimelineSync()
  expect(retry).toHaveBeenCalledExactlyOnceWith('a')
})

it('clears the previous conversation while opening another and ignores its late callbacks', async () => {
  const { runtime, callbacks, unsubscribe, snapshot, emit } = fixture()
  await act(async () => root.render(<Probe runtime={runtime} />))
  const oldMessage: LingTimelineItem = { taskId: 'a', itemId: 'a-1', kind: 'assistant-message', text: 'A 的消息', createdAt: '2026-10-29' }
  await act(async () => callbacks.get('a')!([oldMessage]))
  expect(view.timeline).toEqual([oldMessage])
  await act(async () => view.selectTask('b'))
  expect(unsubscribe).toHaveBeenCalledOnce()
  expect(view.timeline).toEqual([])
  await act(async () => {
    callbacks.get('a')!([oldMessage])
    emit({ ...snapshot, taskTimelineSync: { a: { phase: 'failed', message: 'A 恢复失败' }, b: { phase: 'syncing', message: 'B 同步中' } } })
  })
  expect(view.timeline).toEqual([])
  expect(view.timelineSync?.message).toBe('B 同步中')
})
