import { describe, expect, it, vi } from 'vitest'
import { createDemoRuntimeAdapter } from '../src/runtime/demo-adapter.js'
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
      pendingInteractions: [],
      backgroundJobs: {},
      subagents: {},
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

  it('keeps read capabilities safe while the runtime is offline', async () => {
    const adapter = createOfflineRuntimeAdapter('Host connection is pending.')
    const rejection = {
      ok: false,
      reason: 'runtime-unavailable',
      message: 'Host connection is pending.',
      retryable: false,
    }

    await expect(adapter.searchTasks('renderer')).resolves.toEqual(rejection)
    await expect(adapter.getTaskChanges('task-1')).resolves.toEqual(rejection)
    await expect(adapter.getTaskFileDiff('task-1', 2, 0)).resolves.toEqual(rejection)
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

describe('slash command surface', () => {
  it('does not offer a command catalog while no runtime is connected', () => {
    expect(createOfflineRuntimeAdapter().getTaskCommands).toBeUndefined()
  })

  it('serves the advertised commands through task.run-command and rejects unknown ones', async () => {
    const adapter = createDemoRuntimeAdapter()
    const { tasks } = await adapter.getSnapshot()
    const taskId = tasks[0]?.taskId
    if (taskId === undefined) throw new Error('demo adapter must seed at least one task')
    const commands = await adapter.getTaskCommands?.(taskId)
    expect(commands?.ok).toBe(true)
    if (!commands?.ok) return

    const advertised = commands.value.map(command => `/${command.name}`)
    expect(advertised.length).toBeGreaterThan(0)

    await expect(adapter.dispatch({
      requestId: 'run-1',
      type: 'task.run-command',
      taskId,
      line: `${advertised[0]} extra`,
    })).resolves.toMatchObject({ accepted: true })

    await expect(adapter.dispatch({
      requestId: 'run-2',
      type: 'task.run-command',
      taskId,
      line: '/not-a-real-command',
    })).resolves.toMatchObject({ accepted: false, reason: 'invalid-command' })
  })
})

describe('demo task search', () => {
  it('finds task titles and message content without repeating a task', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.searchTasks('运行时')).resolves.toMatchObject({
      ok: true,
      value: { items: [{ taskId: 'task-seed', title: '重构运行时适配器' }] },
    })
    await expect(adapter.searchTasks('附件')).resolves.toMatchObject({
      ok: true,
      value: { items: [{ taskId: 'task-running', title: '为 Composer 增加附件' }] },
    })
    const result = await adapter.searchTasks('附件')
    expect(result.ok && result.value.items.filter(item => item.taskId === 'task-running')).toHaveLength(1)
  })

  it('finds active tasks by workspace name or path', async () => {
    const adapter = createDemoRuntimeAdapter()

    const byName = await adapter.searchTasks('ling-desktop')
    expect(byName.ok && byName.value.items.map(item => item.taskId)).toEqual(['task-running', 'task-seed'])

    const byPath = await adapter.searchTasks('~/projects/web-playground')
    expect(byPath.ok && byPath.value.items.map(item => item.taskId)).toEqual(['task-plan'])
  })
})

describe('demo change review', () => {
  it('resolves a file diff within the turn named by its sequence', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.getTaskFileDiff('task-seed', 1, 2)).resolves.toMatchObject({
      ok: true,
      value: { before: false, display: 'src/runtime/change-projection.ts' },
    })
    await expect(adapter.getTaskFileDiff('task-seed', 1, 3)).resolves.toMatchObject({
      ok: true,
      value: { after: false, hunks: [{ newStart: 0 }] },
    })
    await expect(adapter.getTaskFileDiff('task-seed', 1, 1)).resolves.toMatchObject({
      ok: true,
      value: { coarse: true, display: 'src/runtime/contract.ts' },
    })
    await expect(adapter.getTaskFileDiff('task-seed', 4, 0)).resolves.toMatchObject({
      ok: false,
      reason: 'task-not-found',
    })
  })
})

describe('demo task cancellation', () => {
  it('keeps a cancelled task cancelled and drops the queued approval request', async () => {
    vi.useFakeTimers()
    try {
      const adapter = createDemoRuntimeAdapter()
      await adapter.dispatch({ requestId: 'create-1', type: 'task.create', prompt: '取消后不应继续运行' })
      const [created] = (await adapter.getSnapshot()).tasks
      if (!created) throw new Error('created task missing')
      await vi.advanceTimersByTimeAsync(400)
      await adapter.dispatch({ requestId: 'cancel-1', type: 'task.cancel', taskId: created.taskId })
      await vi.advanceTimersByTimeAsync(10_000)

      const snapshot = await adapter.getSnapshot()
      const task = snapshot.tasks.find(candidate => candidate.taskId === created.taskId)
      expect(task?.status).toBe('cancelled')
      expect(task?.preview).toContain('已停止当前运行')
      expect(snapshot.pendingInteractions.filter(interaction => interaction.taskId === created.taskId)).toEqual([])
      const timeline = await adapter.getTaskTimeline(created.taskId)
      expect(timeline.some(item => item.kind === 'assistant-message')).toBe(false)
    }
    finally {
      vi.useRealTimers()
    }
  })
})

describe('extension capability reads', () => {
  it('offers skills, agent presets and plugins only through the connected runtime', () => {
    const offline = createOfflineRuntimeAdapter()
    const demo = createDemoRuntimeAdapter()

    expect(offline.getTaskSkills).toBeUndefined()
    expect(offline.getTaskAgentPresets).toBeUndefined()
    expect(offline.listPlugins).toBeUndefined()
    expect(offline.getTaskTerminals).toBeUndefined()
    expect(offline.getTaskSchedules).toBeUndefined()
    expect(demo.getTaskSkills).toBeUndefined()
    expect(demo.getTaskAgentPresets).toBeUndefined()
    expect(demo.listPlugins).toBeUndefined()
    expect(demo.getTaskTerminals).toBeUndefined()
    expect(demo.getTaskSchedules).toBeUndefined()
  })
})

describe('demo subagent actions', () => {
  it('queues a follow-up instruction on a continuable subagent and marks it running', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.promptTaskSubagent?.('task-running', 'sub-run-2', '补充测试清单要点')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    const snapshot = await adapter.getSnapshot()
    expect(snapshot.subagents['task-running']?.subagents).toContainEqual({
      sessionId: 'sub-run-2',
      title: '整理测试清单',
      activity: 'running',
      mode: 'continuable',
      hasChildren: false,
    })
    const timeline = await adapter.getTaskTimeline('task-running')
    expect(timeline.some(entry => entry.text === '已向子任务「整理测试清单」追加指令。')).toBe(true)
  })

  it('rejects an empty instruction, a one-shot subagent and an unknown one', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.promptTaskSubagent?.('task-running', 'sub-run-1', '   ')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-command',
      message: '请输入要追加的指令。',
    })
    await expect(adapter.promptTaskSubagent?.('task-seed', 'sub-seed-1', '继续')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-command',
      message: '该子任务不支持追加指令。',
    })
    await expect(adapter.promptTaskSubagent?.('task-running', 'sub-missing', '继续')).resolves.toMatchObject({
      ok: false,
      reason: 'task-not-found',
      message: '子任务不存在。',
    })
  })

  it('interrupts a running subagent and refuses one that is not running', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.interruptTaskSubagent?.('task-running', 'sub-run-1')).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    const snapshot = await adapter.getSnapshot()
    expect(snapshot.subagents['task-running']?.subagents[0]).toMatchObject({
      sessionId: 'sub-run-1',
      activity: 'inactive',
    })
    const timeline = await adapter.getTaskTimeline('task-running')
    expect(timeline.some(entry => entry.text === '已中断子任务「调研附件交互」。')).toBe(true)

    await expect(adapter.interruptTaskSubagent?.('task-running', 'sub-run-2')).resolves.toMatchObject({
      ok: false,
      reason: 'invalid-command',
      message: '该子任务当前没有在运行。',
    })
  })
})

describe('language preference', () => {
  it('stores the demo preference and follows the browser again once cleared', async () => {
    const adapter = createDemoRuntimeAdapter()

    await expect(adapter.getLocalePreference?.()).resolves.toEqual({ ok: true, value: {} })
    await expect(adapter.setLocalePreference?.('zh')).resolves.toEqual({ ok: true, value: undefined })
    await expect(adapter.getLocalePreference?.()).resolves.toEqual({ ok: true, value: { preference: 'zh' } })
    await expect(adapter.setLocalePreference?.(undefined)).resolves.toEqual({ ok: true, value: undefined })
    await expect(adapter.getLocalePreference?.()).resolves.toEqual({ ok: true, value: {} })
  })

  it('rejects subagent actions and language settings while the runtime is offline', async () => {
    const adapter = createOfflineRuntimeAdapter('Host connection is pending.')
    const rejection = {
      ok: false,
      reason: 'runtime-unavailable',
      message: 'Host connection is pending.',
      retryable: false,
    }

    await expect(adapter.promptTaskSubagent?.('task-1', 'sub-1', '继续')).resolves.toEqual(rejection)
    await expect(adapter.interruptTaskSubagent?.('task-1', 'sub-1')).resolves.toEqual(rejection)
    await expect(adapter.getLocalePreference?.()).resolves.toEqual(rejection)
    await expect(adapter.setLocalePreference?.('zh')).resolves.toEqual(rejection)
  })
})
