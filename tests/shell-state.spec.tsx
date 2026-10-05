// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LingServerService, LingTaskSummary } from '../src/runtime/contract.js'
import { createOfflineRuntimeAdapter } from '../src/runtime/offline-adapter.js'
import { browserNavigationEvent } from '../src/ui/browser-navigation.js'
import { useShellSettingsRouting } from '../src/ui/shell/ShellSettings.js'
import { useShellLayout } from '../src/ui/shell/useShellLayout.js'
import { useTaskMonitor } from '../src/ui/shell/useTaskMonitor.js'
import { useWorkbench } from '../src/ui/shell/useWorkbench.js'

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
  it('composes the real shell without coupling workbench opening to monitor visibility', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
    const { App } = await import('../src/App.js')
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
