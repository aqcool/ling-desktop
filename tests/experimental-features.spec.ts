import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { behaviorKey, parseBehavior, updateBehavior } from '../src/ui/behavior-preferences.js'
import { filterTaskWorkMode, readTaskWorkModes, rememberCreatedTaskMode, taskWorkModesKey } from '../src/ui/task-work-modes.js'
import { defaultTaskViewState, readTaskViewState, visibleTasks } from '../src/ui/task-view.js'
import { CatalogSettings } from '../src/ui/CatalogSettings.js'
import { WorkspaceToolsToolbar } from '../src/ui/WorkspaceTools.js'
import type { LingCommandResult, LingTaskSummary } from '../src/runtime/contract.js'

let data: Map<string, string>
beforeEach(() => {
  data = new Map()
  vi.stubGlobal('localStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value) })
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())

const accepted = (taskId: string): LingCommandResult => ({ accepted: true, requestId: 'request', output: { taskId } })
describe('task work modes', () => {
  it('labels accepted creations once, including retries, and preserves sibling tasks', () => {
    const changed = vi.fn(); window.addEventListener('ling:task-work-modes-changed', changed)
    rememberCreatedTaskMode({ accepted: false, requestId: 'failed', reason: 'runtime-unavailable', message: 'offline', retryable: true }, 'coding')
    rememberCreatedTaskMode({ accepted: true, requestId: 'no-task' }, 'general')
    expect(data.size).toBe(0)
    rememberCreatedTaskMode(accepted('code'), 'coding')
    rememberCreatedTaskMode(accepted('side'), 'general')
    rememberCreatedTaskMode(accepted('code'), 'general')
    expect(readTaskWorkModes()).toEqual({ code: 'coding', side: 'general' })
    expect(changed).toHaveBeenCalledTimes(2)
    expect(JSON.parse(data.get(taskWorkModesKey)!)).toEqual(readTaskWorkModes())
  })
  it('keeps legacy tasks accessible and composes mode filtering with existing views', () => {
    const tasks: LingTaskSummary[] = ['code', 'chat', 'legacy'].map(taskId => ({ taskId, title: taskId, status: 'completed', archived: false, updatedAt: '2026-10-01', workspaceId: taskId === 'legacy' ? 'old' : 'project' }))
    const modes = { code: 'coding', chat: 'general' } as const
    expect(filterTaskWorkMode(tasks, modes, 'coding').map(task => task.taskId)).toEqual(['code', 'legacy'])
    expect(filterTaskWorkMode(tasks, modes, 'general').map(task => task.taskId)).toEqual(['chat', 'legacy'])
    expect(filterTaskWorkMode(tasks, modes)).toBe(tasks)
    const view = { ...defaultTaskViewState.view, workspaceId: 'project' }
    expect(visibleTasks(filterTaskWorkMode(tasks, modes, 'general'), view).map(task => task.taskId)).toEqual(['chat'])
    const all = readTaskViewState(JSON.stringify({ view: { ...view, modeFilter: 'all' } }))
    expect(all.view.modeFilter).toBe('all')
    expect(readTaskViewState(JSON.stringify({ view: { modeFilter: 'invalid' } })).view.modeFilter).toBeUndefined()
  })
  it('ignores invalid labels and reports write failures instead of pretending to persist', () => {
    data.set(taskWorkModesKey, JSON.stringify({ good: 'coding', bad: 'fake', numeric: 1 }))
    expect(readTaskWorkModes()).toEqual({ good: 'coding' })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('Storage full') } })
    expect(() => rememberCreatedTaskMode(accepted('new'), 'general')).toThrow('Storage full')
  })
})

it('keeps existing Actions enabled by default and saves independent experimental switches', () => {
  expect(parseBehavior(null)).toMatchObject({ workspaceActions: true, replyAnnotations: false, separateTaskLists: false })
  updateBehavior({ replyAnnotations: true, separateTaskLists: true, workspaceActions: false })
  updateBehavior({ quickNotes: false })
  expect(parseBehavior(data.get(behaviorKey)!)).toMatchObject({ workspaceActions: false, replyAnnotations: true, separateTaskLists: true, quickNotes: false })
  const markup = renderToStaticMarkup(createElement(CatalogSettings, { tab: 'experimental' }))
  const switches = [...markup.matchAll(/<[^>]*role="switch"[^>]*>/g)].map(match => match[0])
  expect(switches).toHaveLength(5)
  expect(switches.filter(item => /disabled/.test(item))).toHaveLength(1)
  expect(switches.find(item => item.includes('录音纪要'))).toContain('disabled')
})

it('hides only the Actions entry while preserving the workspace opener and saved commands', () => {
  const key = 'ling.workspace-tools.workspace'
  const saved = JSON.stringify({ actions: [{ id: 'dev', name: '开发', command: 'npm run dev', icon: 'play' }] })
  data.set(key, saved)
  const tools = { snapshot: { applications: [{ id: 'files', name: '文件' }], runs: [] }, error: undefined, busy: false, execute: vi.fn() }
  const enabled = renderToStaticMarkup(createElement(WorkspaceToolsToolbar, { workspaceId: 'workspace', tools, onRun: vi.fn(), actionsEnabled: true }))
  const disabled = renderToStaticMarkup(createElement(WorkspaceToolsToolbar, { workspaceId: 'workspace', tools, onRun: vi.fn(), actionsEnabled: false }))
  expect(enabled).toContain('运行 开发')
  expect(disabled).not.toContain('运行 开发')
  expect(disabled).not.toContain('添加工作区命令')
  expect(disabled).toContain('用 文件 打开工作区')
  expect(data.get(key)).toBe(saved)
  expect(tools.execute).not.toHaveBeenCalled()
})
