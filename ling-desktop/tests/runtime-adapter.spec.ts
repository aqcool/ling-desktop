import { describe, expect, it, vi } from 'vitest'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'

describe('offline runtime adapter', () => {
  it('gives a renderer-safe empty snapshot before a Host is connected', async () => {
    const adapter = createOfflineRuntimeAdapter()

    await expect(adapter.getSnapshot()).resolves.toEqual({
      connection: {
        phase: 'offline',
        message: 'LING runtime is not connected yet.',
      },
      workspaces: [],
      tasks: [],
    })
    await expect(adapter.getTaskTimeline('unknown-task')).resolves.toEqual([])
  })

  it('returns a structured rejection that preserves the renderer request ID', async () => {
    const adapter = createOfflineRuntimeAdapter('Host connection is pending.')

    await expect(adapter.dispatch({
      type: 'task.create',
      requestId: 'new-task-1',
      prompt: 'Inspect this repository.',
    })).resolves.toEqual({
      accepted: false,
      requestId: 'new-task-1',
      reason: 'runtime-unavailable',
      message: 'Host connection is pending.',
      retryable: false,
    })
  })

  it('gives callers an unsubscribe handle even while the adapter is offline', () => {
    const adapter = createOfflineRuntimeAdapter()
    const unsubscribe = adapter.subscribe(() => {})
    const timelineListener = vi.fn()
    const unsubscribeTimeline = adapter.subscribeTaskTimeline('unknown-task', timelineListener)

    expect(unsubscribe).toBeTypeOf('function')
    expect(timelineListener).toHaveBeenCalledWith([])
    expect(() => { unsubscribe() }).not.toThrow()
    expect(() => { unsubscribeTimeline() }).not.toThrow()
  })
})
