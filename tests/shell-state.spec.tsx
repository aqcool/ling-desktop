// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.js'
import type { LingPendingMessage, LingRuntimeCommand, LingServerService, LingTaskSummary } from '../src/runtime/contract.js'
import { draftStorageKey, serializeDrafts } from '../src/session-state.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import { browserNavigationEvent } from '../src/ui/browser-navigation.js'
import { useShellSettingsRouting } from '../src/ui/shell/ShellSettings.js'
import { useShellLayout } from '../src/ui/shell/useShellLayout.js'
import { useTaskMonitor } from '../src/ui/shell/useTaskMonitor.js'
import { useWorkbench } from '../src/ui/shell/useWorkbench.js'
import { MessageQueue } from '../src/ui/MessageQueue.js'

const roots = new Set<Root>()
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  window.localStorage.clear()
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 })
})
afterEach(async () => {
  await act(async () => { for (const root of roots) root.unmount() })
  roots.clear()
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(element: ReactNode) {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  roots.add(root)
  await act(async () => { root.render(element) })
  return {
    container,
    render: async (next: ReactNode) => { await act(async () => { root.render(next) }) },
    unmount: async () => { await act(async () => { root.unmount() }); roots.delete(root) },
  }
}
function task(id: string): LingTaskSummary {
  return { taskId: id, title: id, workspaceId: 'project', status: 'completed', archived: false, updatedAt: '2026-10-05T00:00:00Z' }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}

describe('shell state boundaries', () => {
  it('shows all pending input and retains the queue after a failed action', async () => {
    const first: LingPendingMessage = { id: 'one', queueId: 'host-one', delivery: 'queue', status: 'pending', text: '先执行这条', attachments: [] }
    const second: LingPendingMessage = { id: 'two', delivery: 'steer', status: 'sending', text: '另一条消息', attachments: [{ name: '截图.png', kind: 'image' }] }
    const onAction = vi.fn(async () => ({ accepted: false as const, requestId: 'failed', reason: 'runtime-unavailable' as const, retryable: true, message: '连接中断' }))
    const view = await mount(<MessageQueue items={[first, second]} disabled={false} onAction={onAction} />)
    expect(view.container.textContent).toContain('2 条消息待发送')
    expect(view.container.textContent).toContain('先执行这条')
    expect(view.container.textContent).toContain('另一条消息')
    expect(view.container.textContent).toContain('正在发送…')
    expect(view.container.textContent).toContain('截图.png')
    expect(view.container.querySelector('button[aria-label="移除消息：另一条消息"]')).toBeNull()
    await act(async () => { view.container.querySelector<HTMLButtonElement>('button[aria-label="移除消息：先执行这条"]')!.click() })
    expect(onAction).toHaveBeenCalledWith('host-one', 'remove')
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('连接中断')
    expect(view.container.textContent).toContain('先执行这条')
    await view.render(<MessageQueue items={[]} disabled={false} onAction={onAction} />)
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('连接中断')
    await view.render(<MessageQueue key="another-task" items={[]} disabled={false} onAction={onAction} />)
    expect(view.container.textContent).toBe('')
  })
  it.each(['running', 'waiting-for-input'] as const)('keeps the composer active while %s and exposes accepted queue input', async status => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    window.localStorage.setItem(draftStorageKey, serializeDrafts({ a: { text: '先检查日志' } }))
    let publishQueue!: (items: readonly LingPendingMessage[]) => void
    const message: LingPendingMessage = { id: 'rpc', queueId: 'host-id', delivery: 'queue', status: 'pending', text: '先检查日志', attachments: [] }
    const dispatch = vi.fn(async (command: LingRuntimeCommand) => {
      if (command.type === 'task.send-message') publishQueue([message])
      if (command.type === 'task.update-queue') publishQueue([])
      return { accepted: true as const, requestId: command.requestId }
    })
    const runtime = {
      ...createOfflineRuntimeAdapter(), dispatch,
      async getSnapshot() { return { connection: { phase: 'ready' as const }, workspaces: [{ workspaceId: 'project', label: 'Test project' }],
        tasks: [{ ...task('a'), status }], pendingInteractions: [], backgroundJobs: {}, subagents: {} } },
      subscribeTaskPendingMessages(_id: string, fn: typeof publishQueue) { publishQueue = fn; fn([]); return () => {} },
    }
    const view = await mount(<App runtime={runtime} />)
    await act(async () => { view.container.querySelector<HTMLButtonElement>('.sidebar-task__main[title="a"]')!.click() })
    const send = view.container.querySelector<HTMLButtonElement>('button[aria-label="排队发送"]')!
    const input = view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')!
    expect(send.disabled).toBe(false)
    expect(input.disabled).toBe(false)
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.send-message', taskId: 'a', text: '先检查日志', mode: 'queue' }))
    expect(input.value).toBe('')
    const queue = view.container.querySelector('section[aria-label="待发送消息"]')!
    expect(queue.textContent).toContain('先检查日志')
    expect(queue.textContent).toContain('1 条消息待发送')
    expect(view.container.querySelector('[data-conversation-text]')?.textContent ?? '').not.toContain('先检查日志')
    await act(async () => { queue.querySelector<HTMLButtonElement>('button[aria-label="立即插话：先检查日志"]')!.click() })
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'task.update-queue', itemId: 'host-id', action: 'steer' }))
    expect(view.container.querySelector('section[aria-label="待发送消息"]')).toBeNull()
  })

  it('defaults to queue and restores withdrawn text and attachments without resending', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    let publishQueue!: (items: readonly LingPendingMessage[]) => void
    const first: LingPendingMessage = { id: 'one', queueId: 'host-one', delivery: 'queue', status: 'pending', text: '原问题', attachments: [{ kind: 'image', name: '截图.png' }] }
    const second: LingPendingMessage = { id: 'two', queueId: 'host-two', delivery: 'queue', status: 'pending', text: '第二条', attachments: [] }
    const restored = { text: first.text, recordedAttachments: { seq: 7, attachments: [{ attachmentId: 'image', kind: 'image' as const, name: '截图.png' }] } }
    const dispatch = vi.fn(async (command: LingRuntimeCommand) => ({ accepted: true as const, requestId: command.requestId }))
    const withdrawQueuedMessage = vi.fn(async () => { publishQueue([second]); return { ok: true as const, value: restored } })
    const reorderQueuedMessages = vi.fn(async () => { publishQueue([second, first]); return { ok: true as const, value: undefined } })
    const runtime = { ...createOfflineRuntimeAdapter(), dispatch, withdrawQueuedMessage, reorderQueuedMessages,
      async getSnapshot() { return { connection: { phase: 'ready' as const }, workspaces: [], tasks: [{ ...task('a'), status: 'running' as const, workspaceId: undefined }], pendingInteractions: [], backgroundJobs: {}, subagents: {} } },
      subscribeTaskPendingMessages(_id: string, fn: typeof publishQueue) { publishQueue = fn; fn([first, second]); return () => {} },
    }
    const view = await mount(<App runtime={runtime} />)
    await act(async () => { view.container.querySelector<HTMLButtonElement>('.sidebar-task__main[title="a"]')!.click() })
    const input = view.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="消息"]')!
    expect(view.container.querySelector('button[aria-label="运行中发送方式"]')).toBeNull()
    expect(view.container.querySelector('button[aria-label="停止"]')).not.toBeNull()
    await act(async () => { view.container.querySelector<HTMLButtonElement>('button[aria-label="调整排队顺序：第二条"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })) })
    expect(reorderQueuedMessages).toHaveBeenCalledWith('a', ['host-two', 'host-one'])
    const rows = [...view.container.querySelectorAll('section[aria-label="待发送消息"] li')]
    expect(rows[0]?.textContent).toContain('第二条')
    await act(async () => { view.container.querySelector<HTMLButtonElement>('button[aria-label="撤回到输入框编辑：原问题"]')!.click() })
    expect(withdrawQueuedMessage).toHaveBeenCalledWith('a', 'host-one')
    expect(input.value).toBe('原问题')
    expect(view.container.querySelector('section[aria-label="待发送消息"]')?.textContent).not.toContain('原问题')
    expect(dispatch).not.toHaveBeenCalled()
    expect(view.container.querySelector('button[aria-label="排队发送"]')).not.toBeNull()
    await act(async () => { view.container.querySelector<HTMLButtonElement>('button[aria-label="排队发送"]')!.click() })
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'task.send-message', taskId: 'a', text: '原问题', mode: 'queue', recordedAttachments: { seq: 7, attachmentIds: ['image'] } }))
  })
  it('composes the real shell without coupling workbench opening to monitor visibility', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const runtime = {
      ...createOfflineRuntimeAdapter(),
      async getSnapshot() {
        return {
          connection: { phase: 'ready' as const },
          workspaces: [{ workspaceId: 'project', label: 'Test project' }],
          tasks: [task('a')],
          pendingInteractions: [], backgroundJobs: {}, subagents: {},
        }
      },
    }
    const view = await mount(<App runtime={runtime} />)
    const monitor = () => view.container.querySelector('#task-monitor')
    const click = async (selector: string) => {
      const button = view.container.querySelector<HTMLButtonElement>(selector)
      expect(button).not.toBeNull()
      await act(async () => { button!.click() })
    }
    expect(monitor()).toBeNull()
    await click('button[aria-label="展开工作面"]')
    expect(view.container.querySelector('aside[aria-label="工作面"]')).not.toBeNull()
    expect(monitor()).toBeNull()
    await click('button[aria-label="收起工作面"]')
    await click('.sidebar-task__main[title="a"]')
    expect(monitor()?.getAttribute('data-presentation')).toBe('fixed')
    await click('button[aria-label="展开工作面"]')
    expect(monitor()?.getAttribute('data-presentation')).toBe('floating')
    await click('button[aria-label="收起工作面"]')
    expect(monitor()?.getAttribute('data-presentation')).toBe('fixed')
    await click('button[aria-controls="task-monitor"]')
    expect(monitor()).toBeNull()
    await click('button[aria-label="展开工作面"]')
    expect(monitor()).toBeNull()
    const knowledgeEntry = Array.from(view.container.querySelectorAll<HTMLButtonElement>('.sidebar-bottom__item')).find(button => button.textContent === '知识中心')!
    await act(async () => { knowledgeEntry.click() })
    expect(view.container.querySelector('section[aria-label="知识中心主页面"]')).not.toBeNull()
    expect(view.container.querySelector('aside[aria-label="工作面"]')).toBeNull()
    expect(view.container.querySelector('aside[aria-label="项目知识"]')).toBeNull()
    expect(view.container.querySelector('section[aria-label="知识中心主页面"] > header')?.textContent).not.toContain('返回任务')
    expect(view.container.querySelector('.workspace-header')).toBeNull()
    expect(monitor()).toBeNull()
  })

  it('keeps manual monitor visibility and section collapse through workbench and task navigation', async () => {
    let monitor!: ReturnType<typeof useTaskMonitor>
    function Harness(options: Parameters<typeof useTaskMonitor>[0]) {
      monitor = useTaskMonitor(options)
      return <button aria-controls="task-monitor" onClick={monitor.toggleLocalStatus}>monitor</button>
    }
    const options = { screen: 'workspace' as const, taskId: 'a', workbenchOpen: false, workbenchMaximized: false, workspaceAvailableWidth: 1200 }
    const view = await mount(<Harness {...options} />)
    expect(monitor.monitorFixed).toBe(true)
    await act(async () => {
      monitor.sections.set('环境信息', false)
      view.container.querySelector('button')!.click()
    })
    for (const workbenchOpen of [true, false, true]) {
      await view.render(<Harness {...options} workbenchOpen={workbenchOpen} />)
      expect(monitor.monitorOpen).toBe(false)
      expect(monitor.sections.values['环境信息']).toBe(false)
    }
    await view.render(<Harness {...options} taskId="b" />)
    expect(monitor.monitorFixed).toBe(true)
    expect(monitor.sections.values['环境信息']).toBeUndefined()
    await view.render(<Harness {...options} />)
    expect(monitor.monitorOpen).toBe(false)
    expect(monitor.sections.values['环境信息']).toBe(false)
  })

  it('dismisses a temporary floating monitor but respects pinning and child overlays', async () => {
    let monitor!: ReturnType<typeof useTaskMonitor>
    function Harness() {
      monitor = useTaskMonitor({ screen: 'workspace', taskId: 'a', workbenchOpen: true, workbenchMaximized: false, workspaceAvailableWidth: 1200 })
      return <><button aria-controls="task-monitor" onClick={monitor.toggleLocalStatus}>monitor</button><aside ref={monitor.monitorRef}><button>inside</button></aside></>
    }
    const view = await mount(<Harness />)
    await act(async () => { view.container.querySelector('button')!.click() })
    expect(monitor.monitorFloating).toBe(true)
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'menu')
    document.body.append(overlay)
    await act(async () => {
      overlay.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    expect(monitor.monitorOpen).toBe(true)
    overlay.remove()
    await act(async () => { monitor.toggleMonitorPin() })
    await act(async () => { document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })) })
    expect(monitor.monitorOpen).toBe(true)
    await act(async () => { monitor.toggleMonitorPin() })
    await act(async () => { view.container.querySelector('button')!.click() })
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })) })
    expect(monitor.monitorOpen).toBe(false)
  })

  it('keeps browser/file tabs distinct from side tasks and routes browser requests without opening the monitor', async () => {
    let workbench!: ReturnType<typeof useWorkbench>
    let monitor!: ReturnType<typeof useTaskMonitor>
    const onSubmit = vi.fn()
    function Harness() {
      workbench = useWorkbench({ props: { browserOpen: true, screen: 'workspace', prompt: '', onSubmit, onBrowserToggle: vi.fn() }, activeWorkspaceId: 'project', workspaceLabel: 'Project' })
      monitor = useTaskMonitor({ screen: 'workspace', workbenchOpen: true, workbenchMaximized: workbench.workbenchMaximized, workspaceAvailableWidth: 1200 })
      return null
    }
    const view = await mount(<Harness />)
    await act(async () => { workbench.openWorkbenchTab('files') })
    await act(async () => { workbench.openWorkbenchTab('files') })
    expect(workbench.workbenchTabs.map(tab => tab.kind)).toEqual(['files'])
    await act(async () => { workbench.openWorkbenchTab('side-task') })
    await act(async () => { workbench.openWorkbenchTab('side-task') })
    expect(workbench.workbenchTabs.filter(tab => tab.sideTask).map(tab => tab.sideTask?.workspaceId)).toEqual(['project', 'project'])
    await act(async () => { window.dispatchEvent(new CustomEvent(browserNavigationEvent, { detail: { id: 'open-1', url: 'https://example.test/' } })) })
    expect(workbench.activeWorkbenchTab?.kind).toBe('browser')
    expect(workbench.browserNavigation?.id).toBe('open-1')
    expect(monitor.monitorOpen).toBe(false)
    await act(async () => { workbench.closeWorkbenchTab('browser') })
    expect(workbench.activeWorkbenchTab?.kind).toBe('side-task')
    await view.unmount()
    await act(async () => { window.dispatchEvent(new CustomEvent(browserNavigationEvent, { detail: { id: 'open-2', url: 'https://example.test/' } })) })
    expect(workbench.browserNavigation?.id).toBe('open-1')
  })

  it('forwards attachment-only submissions to App instead of silently dropping them', async () => {
    let workbench!: ReturnType<typeof useWorkbench>
    const onSubmit = vi.fn()
    function Harness() {
      workbench = useWorkbench({ props: { browserOpen: false, screen: 'workspace', prompt: '', onSubmit, onBrowserToggle: vi.fn() }, workspaceLabel: 'Project' })
      return null
    }
    await mount(<Harness />)
    await act(async () => { workbench.submitWithBrowserAnnotations() })
    // The shell does not own attachments; App checks text and attachments together.
    expect(onSubmit).toHaveBeenCalledWith('', expect.any(Function))
  })

  it('ignores a late remote terminal request after switching tasks and stops polling on unmount', async () => {
    vi.useFakeTimers()
    type Result = Awaited<ReturnType<LingServerService['takeTerminalUiRequest']>>
    const oldRequest = deferred<Result>()
    const takeTerminalUiRequest = vi.fn<LingServerService['takeTerminalUiRequest']>(id => id === 'a' ? oldRequest.promise : Promise.resolve({ ok: true, value: { open: false } }))
    const service = { takeTerminalUiRequest } as unknown as LingServerService
    let workbench!: ReturnType<typeof useWorkbench>
    function Harness({ taskId }: { taskId: string }) {
      workbench = useWorkbench({ props: { browserOpen: true, screen: 'workspace', selectedTask: task(taskId), serverManager: service, prompt: '', onSubmit: vi.fn(), onBrowserToggle: vi.fn() }, activeOperationsServerId: 'server', workspaceLabel: 'Project' })
      return null
    }
    const view = await mount(<Harness taskId="a" />)
    await view.render(<Harness taskId="b" />)
    await act(async () => { oldRequest.resolve({ ok: true, value: { open: true } }) })
    expect(workbench.workbenchTabs).toEqual([])
    await view.unmount()
    const calls = takeTerminalUiRequest.mock.calls.length
    await act(async () => { vi.advanceTimersByTime(2400) })
    expect(takeTerminalUiRequest).toHaveBeenCalledTimes(calls)
  })

  it('retains settings navigation state when the settings page is hidden', async () => {
    let routing!: ReturnType<typeof useShellSettingsRouting>
    function Harness({ tab, visible }: { tab: 'memory' | 'monitor'; visible: boolean }) {
      routing = useShellSettingsRouting(tab)
      return visible ? <span>settings</span> : null
    }
    const view = await mount(<Harness tab="memory" visible />)
    await act(async () => { routing.setMemoryRecapRequested(true); routing.setSettingsGitWorkspace('project') })
    await view.render(<Harness tab="memory" visible={false} />)
    await view.render(<Harness tab="memory" visible />)
    expect(routing.memoryRecapRequested).toBe(true)
    expect(routing.settingsGitWorkspace).toBe('project')
    await view.render(<Harness tab="monitor" visible />)
    expect(routing.memoryRecapRequested).toBe(false)
  })

  it('preserves saved layout dimensions and suspends the sidebar shortcut during a dialog', async () => {
    window.localStorage.setItem('ling.sidebar-width', '300')
    window.localStorage.setItem('ling.workbench-width.v3', '48')
    window.localStorage.setItem('ling.terminal-height', '220')
    let layout!: ReturnType<typeof useShellLayout>
    function Harness({ blocked }: { blocked: boolean }) {
      layout = useShellLayout({ shortcutBlocked: blocked })
      return null
    }
    const view = await mount(<Harness blocked />)
    expect(layout.displayedSidebarWidth).toBe(300)
    expect(layout.workbenchWidth).toBe(48)
    expect(layout.terminalHeight).toBe(220)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true })) })
    expect(layout.sidebarCollapsed).toBe(false)
    await view.render(<Harness blocked={false} />)
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, cancelable: true })) })
    expect(layout.sidebarCollapsed).toBe(true)
    expect(window.localStorage.getItem('ling.sidebar')).toBe('collapsed')
  })
})
